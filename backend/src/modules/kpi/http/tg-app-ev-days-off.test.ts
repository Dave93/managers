import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-ev-violations.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: выходные (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, evSession, makeEmployee, makeEvaluator, makeScope, makeTerminal, setNow, setup, tgApi, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { kpi_days_off, kpi_periods } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const URL_GIVE = "/api/kpi/tg/ev/days-off";
  const OUT = { status: 403, body: { error: "out_of_scope" } };
  const NOT_FOUND = { status: 404, body: { error: "not_found" } };
  // «Сегодня» теста: 26 октября 2025, окно дат — с 25.10.2024 по 26.11.2025.
  const NOW = "2025-10-26T10:00:00+05:00";

  describe("kpi: оценщик в мини-приложении, выходные", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookCardId: string;
    let otherCardId: string;
    let prevToken: string | undefined;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string }[];
      cookCardId = cards.find((c) => c.code === "cook")!.id;
      otherCardId = cards.find((c) => c.code !== "cook")!.id;
    }, 180000);

    afterAll(async () => {
      setNow(null);
      // undefined в process.env стал бы строкой "undefined": следующие файлы ходили бы в Telegram.
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    // Оценщик с назначением на филиал и его сотрудник-повар.
    const world = async () => {
      const t = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      return { t, ev, e, token: await evSession(db, ev.id) };
    };
    const give = (token: string, employee_id: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
      tgApi(token, "POST", URL_GIVE, { employee_id, from, to, reason_code: "sick", ...extra });
    const rowsOf = (employee_id: string) => db.select().from(kpi_days_off).where(eq(kpi_days_off.employee_id, employee_id));
    const closeMonth = async (period: string) => {
      await db.insert(kpi_periods).values({ period, status: "closed" }).onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });
    };
    const reopenMonth = async (period: string) => {
      await db.delete(kpi_periods).where(eq(kpi_periods.period, period));
    };

    it("выдача на 3 дня: ответ и строки в базе (филиал сотрудника, автор, причина)", async () => {
      setNow(NOW);
      const { t, ev, e, token } = await world();
      const r = await give(token, e.id, "2025-10-27", "2025-10-29");
      expect(r.status).toBe(200);
      expect(r.body.skipped).toEqual([]);
      expect(r.body.created.map((x: { day: string }) => x.day)).toEqual(["2025-10-27", "2025-10-28", "2025-10-29"]);
      expect(r.body.created[0]).toMatchObject({ employee_id: e.id, reason_code: "sick", reason_text: null, status: "active", can_cancel: true });
      expect(r.body.created[0].employee_name).toContain("Тест Повар");
      const rows = await rowsOf(e.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((x) => x.terminal_id === t.id && x.given_by === ev.id && x.cancelled_at === null)).toBe(true);
    });

    it("«другая» причина хранит текст, остальные текст не хранят", async () => {
      setNow(NOW);
      const { e, token } = await world();
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other", reason_text: "  Свадьба брата  " })).body.created[0]).toMatchObject({
        reason_code: "other",
        reason_text: "Свадьба брата",
      });
      expect((await give(token, e.id, "2025-10-28", "2025-10-28", { reason_code: "family", reason_text: "игнорируется" })).body.created[0]).toMatchObject({
        reason_code: "family",
        reason_text: null,
      });
    });

    it("повтор того же запроса ничего не ломает и перечисляет пропущенные; после отмены день выдаётся заново", async () => {
      setNow(NOW);
      const { e, token } = await world();
      const first = await give(token, e.id, "2025-10-27", "2025-10-29");
      const again = await give(token, e.id, "2025-10-27", "2025-10-29");
      expect(again.status).toBe(200);
      expect(again.body.created).toEqual([]);
      expect(again.body.skipped).toEqual(["2025-10-27", "2025-10-28", "2025-10-29"]);
      expect(await rowsOf(e.id)).toHaveLength(3);

      const cancelled = await tgApi(token, "POST", `${URL_GIVE}/${first.body.created[1].id}/cancel`);
      expect(cancelled.status).toBe(200);
      const regive = await give(token, e.id, "2025-10-27", "2025-10-29", { reason_code: "vacation" });
      expect(regive.body.created.map((x: { day: string }) => x.day)).toEqual(["2025-10-28"]);
      expect(regive.body.created[0].reason_code).toBe("vacation");
      expect(regive.body.skipped).toEqual(["2025-10-27", "2025-10-29"]);
      expect(await rowsOf(e.id)).toHaveLength(4); // три активных и одна отменённая
    });

    it("диапазон через границу с закрытым месяцем: 409, ни одной строки", async () => {
      setNow(NOW);
      const { e, token } = await world();
      await closeMonth("2025-09-01");
      try {
        const r = await give(token, e.id, "2025-09-29", "2025-10-02");
        expect(r).toEqual({ status: 409, body: { error: "period_closed" } });
        expect(await rowsOf(e.id)).toHaveLength(0);
        // Тот же диапазон без закрытой части проходит.
        expect((await give(token, e.id, "2025-10-01", "2025-10-02")).status).toBe(200);
      } finally {
        await reopenMonth("2025-09-01");
      }
    });

    it("неверная причина, текст и даты", async () => {
      setNow(NOW);
      const { e, token } = await world();
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other" })).body).toEqual({ error: "reason_text_required" });
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "other", reason_text: "ab" })).body).toEqual({ error: "reason_text_required" });
      expect((await give(token, e.id, "2025-10-27", "2025-10-27", { reason_code: "holiday" })).body).toEqual({ error: "bad_reason" });
      expect((await give(token, e.id, "2025-10-29", "2025-10-27")).body).toEqual({ error: "bad_dates" });
      expect((await give(token, e.id, "2025-02-30", "2025-03-01")).body).toEqual({ error: "bad_dates" });
      expect((await give(token, e.id, "2025-10-01", "2025-11-05")).body).toEqual({ error: "bad_dates" }); // 36 дней
      expect((await give(token, e.id, "2025-12-01", "2025-12-01")).body).toEqual({ error: "bad_dates" }); // дальше сегодня + 31
      expect(await rowsOf(e.id)).toHaveLength(0);
    });

    it("чужой филиал, неактивный, не uuid, без employee_id, назначение по карте", async () => {
      setNow(NOW);
      const { t, ev, token } = await world();
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      expect(await give(token, foreign.id, "2025-10-27", "2025-10-27")).toEqual(OUT);
      const inactive = await makeEmployee(db, { role_code: "cook", terminal_id: t.id, active: false });
      expect(await give(token, inactive.id, "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect(await give(token, "x", "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect(await give(token, randomUUID(), "2025-10-27", "2025-10-27")).toEqual(NOT_FOUND);
      expect((await tgApi(token, "POST", URL_GIVE, { from: "2025-10-27", to: "2025-10-27", reason_code: "sick" })).body).toEqual({ error: "bad_id" });

      // Оценщик только по чужой карте не выдаёт выходные повару своего филиала.
      const evCard = await makeEvaluator(db);
      await makeScope(db, evCard.id, { terminal_id: t.id, card_id: otherCardId });
      const cook = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      expect(await give(await evSession(db, evCard.id), cook.id, "2025-10-27", "2025-10-27")).toEqual(OUT);
      const evOwnCard = await makeEvaluator(db);
      await makeScope(db, evOwnCard.id, { terminal_id: t.id, card_id: cookCardId });
      expect((await give(await evSession(db, evOwnCard.id), cook.id, "2025-10-27", "2025-10-27")).status).toBe(200);
      expect(ev.id).toBeTruthy();
    });

    it("отмена: автор, чужой оценщик, повтор, закрытый месяц, мусорный id", async () => {
      setNow(NOW);
      const { t, e, token } = await world();
      const other = await makeEvaluator(db);
      await makeScope(db, other.id, { terminal_id: t.id });
      const otherToken = await evSession(db, other.id);

      const [d1, d2] = (await give(token, e.id, "2025-10-27", "2025-10-28")).body.created as { id: string }[];
      expect(await tgApi(otherToken, "POST", `${URL_GIVE}/${d1.id}/cancel`)).toEqual({ status: 403, body: { error: "forbidden" } });
      const ok = await tgApi(token, "POST", `${URL_GIVE}/${d1.id}/cancel`);
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: d1.id, status: "cancelled", can_cancel: false });
      expect(await tgApi(token, "POST", `${URL_GIVE}/${d1.id}/cancel`)).toEqual({ status: 409, body: { error: "already_cancelled" } });
      expect(await tgApi(token, "POST", `${URL_GIVE}/x/cancel`)).toEqual(NOT_FOUND);
      expect(await tgApi(token, "POST", `${URL_GIVE}/${randomUUID()}/cancel`)).toEqual(NOT_FOUND);

      await closeMonth("2025-10-01");
      try {
        expect(await tgApi(token, "POST", `${URL_GIVE}/${d2.id}/cancel`)).toEqual({ status: 409, body: { error: "period_closed" } });
      } finally {
        await reopenMonth("2025-10-01");
      }
    });

    it("список месяца: только мои, отменённые видны, право отмены по закрытию месяца", async () => {
      setNow(NOW);
      const { t, e, token } = await world();
      const other = await makeEvaluator(db);
      await makeScope(db, other.id, { terminal_id: t.id });
      const mine = (await give(token, e.id, "2025-10-27", "2025-10-28")).body.created as { id: string }[];
      await give(await evSession(db, other.id), e.id, "2025-10-29", "2025-10-29"); // чужой выходной
      await tgApi(token, "POST", `${URL_GIVE}/${mine[0].id}/cancel`);

      const list = await tgApi(token, "GET", `${URL_GIVE}?period=2025-10-01`);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ period: "2025-10-01", period_status: "open" });
      const byDay = new Map(list.body.items.map((x: { day: string }) => [x.day, x]));
      expect([...byDay.keys()].sort()).toEqual(["2025-10-27", "2025-10-28"]);
      expect(byDay.get("2025-10-27")).toMatchObject({ status: "cancelled", can_cancel: false });
      expect(byDay.get("2025-10-28")).toMatchObject({ status: "active", can_cancel: true });
      expect(list.body.items[0].day > list.body.items[1].day).toBe(true); // новые сверху

      await closeMonth("2025-10-01");
      try {
        const closed = await tgApi(token, "GET", `${URL_GIVE}?period=2025-10-01`);
        expect(closed.body.period_status).toBe("closed");
        expect(closed.body.items.every((x: { can_cancel: boolean }) => x.can_cancel === false)).toBe(true);
      } finally {
        await reopenMonth("2025-10-01");
      }
      // Без period — месяц «сейчас».
      expect((await tgApi(token, "GET", URL_GIVE)).body.period).toBe("2025-10-01");
      expect(await tgApi(token, "GET", `${URL_GIVE}?period=bad`)).toEqual({ status: 422, body: { error: "bad_period" } });
    });

    it("форма: причины, окно, лимит диапазона, уже выданные дни; права и назначение", async () => {
      setNow(NOW);
      const { e, token } = await world();
      await give(token, e.id, "2025-10-30", "2025-10-31");
      await closeMonth("2025-09-01");
      try {
        const f = await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`);
        expect(f.status).toBe(200);
        expect(f.body).toMatchObject({
          employee: { id: e.id },
          reasons: ["sick", "family", "time_off", "vacation", "schedule", "other"],
          window: { min: "2025-10-01", max: "2025-11-26" },
          max_range_days: 31,
          existing: ["2025-10-30", "2025-10-31"],
        });
      } finally {
        await reopenMonth("2025-09-01");
      }
      // Без закрытых месяцев нижняя граница — сегодня минус 366 дней.
      expect((await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`)).body.window.min).toBe("2024-10-25");

      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      expect(await tgApi(token, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${foreign.id}`)).toEqual(OUT);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/day-off-form")).toEqual(NOT_FOUND);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/day-off-form?employee_id=x")).toEqual(NOT_FOUND);

      const viewer = await makeEvaluator(db, { perms: ["kpi.view"] });
      const viewerToken = await evSession(db, viewer.id);
      expect((await tgApi(viewerToken, "GET", `/api/kpi/tg/ev/day-off-form?employee_id=${e.id}`)).body).toEqual({ error: "forbidden" });
      expect((await give(viewerToken, e.id, "2025-10-27", "2025-10-27")).body).toEqual({ error: "forbidden" });
    });
  });
}
