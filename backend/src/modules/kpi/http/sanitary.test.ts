import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в reviews.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/sanitary (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeScope, makeTerminal, setNow, setup } = await import("./fixtures");
  const { kpi_periods, kpi_sanitary_checks } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const ITEMS = ["Чистота", "Санитария", "Форма персонала", "Хранение продуктов", "Маркировка"];

  describe("kpi: санитарные проверки", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookCardId: string;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      setNow("2026-11-02T10:00:00+05:00");
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookCardId = cards.find((c) => c.code === "cook")!.id;
    });
    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    const items = (fails = 0) => ITEMS.map((title, i) => ({ title, ok: i >= fails }));
    const post = (s: Session | null, body: unknown) => api(s, "POST", "/api/kpi/sanitary-checks", body);

    it("шаблон: оценщику и HR — пять пунктов, наблюдателю — 403", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "GET", "/api/kpi/sanitary-checks/template")).body).toEqual({ items: ITEMS });
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "GET", "/api/kpi/sanitary-checks/template")).status).toBe(200);
      const v = await withSession({ permissions: ["kpi.view", "kpi.approve"] });
      expect((await api(v, "GET", "/api/kpi/sanitary-checks/template")).status).toBe(403);
    });

    it("оценщик с назначением на филиал записывает проверку; месяц по Ташкенту", async () => {
      const t = await makeTerminal(db);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: t.id, card_id: cookCardId }); // карта любая: назначение на повара тоже даёт право
      const r = await post(ev, { terminal_id: t.id, checked_at: "2026-10-31T19:30:00Z", items: items(1), comment: "  маркировка в холодильнике  " });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ terminal_id: t.id, period: "2026-11-01", pct: 80, comment: "маркировка в холодильнике", inspector_user_id: ev.userId });
      expect(r.body.items[0]).toEqual({ title: "Чистота", ok: false });
    });

    it("права: без сессии 401; чужой филиал и kpi.view — 403; kpi.manage — 200", async () => {
      const t = await makeTerminal(db), u = await makeTerminal(db);
      expect((await post(null, { terminal_id: t.id, items: items() })).status).toBe(401);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: u.id });
      expect((await post(ev, { terminal_id: t.id, items: items() })).body).toEqual({ error: "out_of_scope" });
      const v = await withSession({ permissions: ["kpi.view"], terminals: [t.id] });
      expect((await post(v, { terminal_id: t.id, items: items() })).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await post(hr, { terminal_id: t.id, items: items() })).body.pct).toBe(100);
    });

    it("ошибки ввода", async () => {
      const t = await makeTerminal(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await post(hr, { terminal_id: "nope", items: items() })).body).toEqual({ error: "unknown_terminal" });
      expect((await post(hr, { terminal_id: randomUUID(), items: items() })).body).toEqual({ error: "unknown_terminal" });
      for (const bad of [[], [{ title: "", ok: true }], [{ title: "Чистота", ok: "yes" }], Array.from({ length: 31 }, () => ({ title: "x", ok: true }))]) {
        expect((await post(hr, { terminal_id: t.id, items: bad })).body).toEqual({ error: "bad_items" });
      }
      expect((await post(hr, { terminal_id: t.id, items: items(), checked_at: "2026-11-02T10:10:00+05:00" })).body).toEqual({ error: "bad_checked_at" });
      expect((await post(hr, { terminal_id: t.id, items: items(), checked_at: "вчера" })).body).toEqual({ error: "bad_checked_at" });
      expect((await post(hr, { terminal_id: t.id, items: items(), comment: "x".repeat(1001) })).body).toEqual({ error: "comment_too_long" });
    });

    it("закрытый месяц — 409 period_closed", async () => {
      const t = await makeTerminal(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      await db.insert(kpi_periods).values({ period: "2026-09-01", status: "closed" });
      expect((await post(hr, { terminal_id: t.id, items: items(), checked_at: "2026-09-15T10:00:00+05:00" })).body).toEqual({ error: "period_closed" });
      expect(await db.select().from(kpi_sanitary_checks).where(eq(kpi_sanitary_checks.terminal_id, t.id))).toEqual([]);
    });

    it("список: kpi.view видит свои филиалы, чужой — 403; оценщик видит покрытый", async () => {
      const t = await makeTerminal(db), u = await makeTerminal(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      await post(hr, { terminal_id: t.id, items: items(), checked_at: "2026-10-10T10:00:00+05:00" });
      await post(hr, { terminal_id: u.id, items: items(2), checked_at: "2026-10-11T10:00:00+05:00" });
      const v = await withSession({ permissions: ["kpi.view"], terminals: [t.id] });
      const mine = (await api(v, "GET", "/api/kpi/sanitary-checks?period=2026-10-01")).body;
      expect(mine.map((c: any) => c.terminal_id)).toEqual([t.id]);
      expect((await api(v, "GET", `/api/kpi/sanitary-checks?period=2026-10-01&terminal_id=${u.id}`)).body).toEqual({ error: "out_of_scope" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: u.id });
      const theirs = (await api(ev, "GET", `/api/kpi/sanitary-checks?period=2026-10-01&terminal_id=${u.id}`)).body;
      expect(theirs.map((c: any) => c.pct)).toEqual([60]);
      expect((await api(v, "GET", "/api/kpi/sanitary-checks?period=2026-10-15")).body).toEqual({ error: "bad_period" });
    });
  });
}
