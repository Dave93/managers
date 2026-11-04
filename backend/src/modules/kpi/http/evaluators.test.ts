import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в cards.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/evaluators (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, setup } = await import("./fixtures");
  const { users } = await import("backend/drizzle/schema");
  const { like } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type ScopeRow = import("../types").ScopeRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  describe("kpi: массовое назначение оценщику", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let hr: Session;

    const cardIds = async (...codes: string[]): Promise<string[]> => {
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      return codes.map((code) => cards.find((c) => c.code === code)!.id);
    };
    const post = (body: Record<string, unknown>) => api(hr, "POST", "/api/kpi/evaluators", body);
    // Назначения пользователя как отсортированные пары «карта|филиал» (null → "-").
    const scopes = async (userId: string): Promise<string[]> => {
      const all = (await api(hr, "GET", "/api/kpi/evaluators")).body as ScopeRow[];
      return all
        .filter((s) => s.user_id === userId)
        .map((s) => `${s.card_id ?? "-"}|${s.terminal_id ?? "-"}`)
        .sort();
    };
    const pairs = (cards: (string | null)[], terminals: (string | null)[]): string[] =>
      cards.flatMap((c) => terminals.map((t) => `${c ?? "-"}|${t ?? "-"}`)).sort();

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      hr = await withSession({ permissions: ["kpi.manage"] });
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await db.delete(users).where(like(users.login, "test_kpi_%"));
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("массив филиалов × карт: создаёт все комбинации, повтор пропускает", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1, c2] = await cardIds("cook", "cashier");
      const [t1, t2, t3] = [randomUUID(), randomUUID(), randomUUID()];

      const first = await post({ user_id: ev.userId, card_ids: [c1, c2], terminal_ids: [t1, t2] });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ created: 4, skipped: 0 });
      expect(await scopes(ev.userId)).toEqual(pairs([c1, c2], [t1, t2]));

      const again = await post({ user_id: ev.userId, card_ids: [c1, c2], terminal_ids: [t1, t2] });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ created: 0, skipped: 4 });

      const wider = await post({ user_id: ev.userId, card_ids: [c1, c2], terminal_ids: [t1, t2, t3] });
      expect(wider.body).toEqual({ created: 2, skipped: 4 });
      const rows = await scopes(ev.userId);
      expect(rows).toHaveLength(6);
      expect(rows).toEqual(pairs([c1, c2], [t1, t2, t3]));

      // Строки другого пользователя не мешают и не считаются дублями.
      const other = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await post({ user_id: other.userId, card_ids: [c1], terminal_ids: [t1] })).body).toEqual({
        created: 1,
        skipped: 0,
      });
      expect(await scopes(ev.userId)).toHaveLength(6);
    });

    it("пустые массивы — «все»: одна строка null/null; повтор — skipped 1", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1] = await cardIds("cook");
      const t1 = randomUUID();

      const first = await post({ user_id: ev.userId, card_ids: [], terminal_ids: [] });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ created: 1, skipped: 0 });
      expect(await scopes(ev.userId)).toEqual(["-|-"]);
      expect((await post({ user_id: ev.userId, card_ids: [], terminal_ids: [] })).body).toEqual({ created: 0, skipped: 1 });

      // Один пустой массив — «все» по этому измерению; другое измерение задано.
      expect((await post({ user_id: ev.userId, card_ids: [c1], terminal_ids: [] })).body).toEqual({ created: 1, skipped: 0 });
      expect((await post({ user_id: ev.userId, card_ids: [], terminal_ids: [t1] })).body).toEqual({ created: 1, skipped: 0 });
      expect(await scopes(ev.userId)).toEqual(["-|-", `-|${t1}`, `${c1}|-`].sort());

      // Нет ключа terminal_ids — то же, что пустой массив; есть ключ card_ids, значит новый путь.
      const only = await withSession({ permissions: ["kpi.evaluate"] });
      const res = await post({ user_id: only.userId, card_ids: [c1] });
      expect(res.body).toEqual({ created: 1, skipped: 0 });
      expect(await scopes(only.userId)).toEqual([`${c1}|-`]);
      expect((await post({ user_id: only.userId, card_ids: [c1], terminal_ids: [] })).body).toEqual({ created: 0, skipped: 1 });
    });

    it("дубликаты внутри массива схлопываются; 600 комбинаций — 422 too_many", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1] = await cardIds("cook");
      const t1 = randomUUID();

      // Повторы и разный регистр одного uuid — одна комбинация.
      const dedup = await post({
        user_id: ev.userId,
        card_ids: [c1, c1.toUpperCase(), c1],
        terminal_ids: [t1, t1.toUpperCase(), t1],
      });
      expect(dedup.body).toEqual({ created: 1, skipped: 0 });
      expect(await scopes(ev.userId)).toEqual([`${c1}|${t1}`]);
      // Тот же uuid в верхнем регистре — не новая строка, а дубль.
      expect((await post({ user_id: ev.userId, card_ids: [c1.toUpperCase()], terminal_ids: [t1] })).body).toEqual({
        created: 0,
        skipped: 1,
      });

      // 30 филиалов × 20 карт = 600 > 500; лимит проверяется раньше существования карт.
      const big = await withSession({ permissions: ["kpi.evaluate"] });
      const tooMany = await post({
        user_id: big.userId,
        terminal_ids: Array.from({ length: 30 }, () => randomUUID()),
        card_ids: Array.from({ length: 20 }, () => randomUUID()),
      });
      expect(tooMany.status).toBe(422);
      expect(tooMany.body).toEqual({ error: "too_many" });
      expect(await scopes(big.userId)).toEqual([]);

      // Граница: ровно 500 комбинаций проходят, 501 — нет.
      const limit = await withSession({ permissions: ["kpi.evaluate"] });
      const ok = await post({
        user_id: limit.userId,
        card_ids: [c1],
        terminal_ids: Array.from({ length: 500 }, () => randomUUID()),
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ created: 500, skipped: 0 });
      expect(await scopes(limit.userId)).toHaveLength(500);
      const over = await post({
        user_id: limit.userId,
        card_ids: [],
        terminal_ids: Array.from({ length: 501 }, () => randomUUID()),
      });
      expect(over.status).toBe(422);
      expect(over.body).toEqual({ error: "too_many" });
      expect(await scopes(limit.userId)).toHaveLength(500);
    });

    it("плохой uuid — 422 bad_id; чужая карта — 422 unknown_card; без kpi.manage — 403", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1] = await cardIds("cook");
      const t1 = randomUUID();
      const bad = { status: 422, body: { error: "bad_id" } };
      const send = async (body: Record<string, unknown>) => {
        const r = await post(body);
        return { status: r.status, body: r.body };
      };

      expect(await send({ user_id: ev.userId, card_ids: [c1, "не-uuid"], terminal_ids: [t1] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_ids: [c1], terminal_ids: ["x"] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_ids: [c1], terminal_ids: [123] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_ids: [null], terminal_ids: [] })).toEqual(bad);
      // Не массив: строка, null, объект.
      expect(await send({ user_id: ev.userId, card_ids: c1, terminal_ids: [] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_ids: [], terminal_ids: null })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_ids: {}, terminal_ids: [] })).toEqual(bad);
      // user_id: не uuid и отсутствует.
      expect(await send({ user_id: "x", card_ids: [], terminal_ids: [] })).toEqual(bad);
      expect(await send({ card_ids: [], terminal_ids: [] })).toEqual(bad);

      // Несуществующая карта: вся пачка отклоняется, ничего не создаётся (в том числе для существующей карты).
      const foreign = randomUUID();
      const unknown = await send({ user_id: ev.userId, card_ids: [c1, foreign], terminal_ids: [t1] });
      expect(unknown).toEqual({ status: 422, body: { error: "unknown_card" } });
      expect(await scopes(ev.userId)).toEqual([]);

      // Права: без kpi.manage — 403 (kpi.evaluate недостаточно), без сессии — 401; ничего не создано.
      const body = { user_id: ev.userId, card_ids: [c1], terminal_ids: [t1] };
      expect((await api(ev, "POST", "/api/kpi/evaluators", body)).status).toBe(403);
      expect((await api(null, "POST", "/api/kpi/evaluators", body)).status).toBe(401);
      expect(await scopes(ev.userId)).toEqual([]);
    });

    it("три параллельных одинаковых запроса не создают дублей", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1, c2] = await cardIds("cook", "cashier");
      const [t1, t2] = [randomUUID(), randomUUID()];
      const body = { user_id: ev.userId, card_ids: [c1, c2], terminal_ids: [t1, t2] };

      const rs = await Promise.all([1, 2, 3].map(() => post(body)));
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
      const res = rs.map((r) => r.body as { created: number; skipped: number });
      expect(res.reduce((n, r) => n + r.created, 0)).toBe(4);
      expect(res.reduce((n, r) => n + r.skipped, 0)).toBe(8);
      expect(await scopes(ev.userId)).toEqual(pairs([c1, c2], [t1, t2]));

      // То же для «все»: ровно одна строка null/null.
      const all = await withSession({ permissions: ["kpi.evaluate"] });
      const rs2 = await Promise.all(
        [1, 2, 3].map(() => post({ user_id: all.userId, card_ids: [], terminal_ids: [] }))
      );
      expect(rs2.reduce((n, r) => n + (r.body as { created: number }).created, 0)).toBe(1);
      expect(await scopes(all.userId)).toEqual(["-|-"]);
    });

    it("смешанное тело (одиночное поле вместе с массивом) — 422 bad_id и ничего не записано", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1] = await cardIds("cook");
      const [t1, t2] = [randomUUID(), randomUUID()];
      const send = async (body: Record<string, unknown>) => {
        const r = await post(body);
        return { status: r.status, body: r.body };
      };
      const bad = { status: 422, body: { error: "bad_id" } };

      // Без отказа card_id молча терялся бы, а назначение расширялось до «всех карт».
      expect(await send({ user_id: ev.userId, card_id: c1, terminal_ids: [t1, t2] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, terminal_id: t1, card_ids: [c1] })).toEqual(bad);
      // Решает наличие ключа, а не значение: null и пустой массив тоже смешение.
      expect(await send({ user_id: ev.userId, card_id: null, terminal_ids: [t1] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, terminal_id: null, card_ids: [] })).toEqual(bad);
      expect(await send({ user_id: ev.userId, card_id: c1, terminal_id: t1, card_ids: [c1], terminal_ids: [t1] })).toEqual(bad);
      expect(await scopes(ev.userId)).toEqual([]);

      // Прежний формат и массовый по отдельности работают как раньше.
      expect((await post({ user_id: ev.userId, card_id: c1, terminal_id: null })).status).toBe(200);
      expect((await post({ user_id: ev.userId, card_ids: [c1], terminal_ids: [t1, t2] })).body).toEqual({ created: 2, skipped: 0 });
      expect(await scopes(ev.userId)).toEqual(pairs([c1], [null, t1, t2]));
    });

    it("прежний формат с одиночными card_id/terminal_id работает без изменений", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      const [c1] = await cardIds("cook");
      const t1 = randomUUID();

      const first = await post({ user_id: ev.userId, card_id: c1, terminal_id: t1 });
      expect(first.status).toBe(200);
      // Прежний ответ — одна строка, не { created, skipped }.
      expect(first.body).toMatchObject({ user_id: ev.userId, card_id: c1, terminal_id: t1 });
      expect(typeof first.body.id).toBe("string");
      expect(first.body.created).toBeUndefined();
      expect(first.body.skipped).toBeUndefined();

      const dup = await post({ user_id: ev.userId, card_id: c1, terminal_id: t1 });
      expect(dup.status).toBe(409);
      expect(dup.body).toEqual({ error: "scope_exists" });

      // Строка, созданная массовым путём, тоже даёт 409 на прежнем пути, и наоборот — skipped.
      expect((await post({ user_id: ev.userId, card_ids: [], terminal_ids: [] })).body).toEqual({ created: 1, skipped: 0 });
      const dupAll = await post({ user_id: ev.userId, card_id: null, terminal_id: null });
      expect(dupAll.status).toBe(409);
      expect(dupAll.body).toEqual({ error: "scope_exists" });
      expect((await post({ user_id: ev.userId, card_ids: [c1], terminal_ids: [t1] })).body).toEqual({ created: 0, skipped: 1 });

      expect((await post({ user_id: "x", card_id: null, terminal_id: null })).body).toEqual({ error: "bad_id" });
      expect(await scopes(ev.userId)).toEqual(["-|-", `${c1}|${t1}`].sort());
    });
  });
}
