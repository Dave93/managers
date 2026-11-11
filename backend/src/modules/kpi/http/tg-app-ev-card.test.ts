import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-ev-list.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: карточка сотрудника (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, evSession, fakeBotApi, makeEmployee, makeEvaluator, makeScope, makeTerminal, setNow, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedReview } = await import("../tg-app/dev-data");

  describe("kpi: оценщик в мини-приложении, карточка сотрудника", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
    }, 180000);

    beforeEach(() => {
      setTestBotApi(fakeBotApi().api);
      setNow("2025-10-26T10:00:00+05:00");
    });

    afterAll(async () => {
      setNow(null);
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    const card = (token: string | null, id: string, q = "") => tgApi(token, "GET", `/api/kpi/tg/ev/employees/${id}/card${q}`);

    it("сотрудник из назначения: справка без сумм прибавки и служебных признаков", async () => {
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      const r = await card(token, e.id);
      expect(r.status).toBe(200);
      // без period — текущий месяц по Ташкенту (время подменено на 26.10.2025)
      expect(r.body).toMatchObject({ period: "2025-10-01", employee: { id: e.id, terminal_name: t1.name, active: true }, review: null, violations: [], days: [] });
      expect(Object.keys(r.body).sort()).toEqual(["days", "employee", "history", "months", "period", "review", "violations"]);
      const json = JSON.stringify(r.body);
      for (const forbidden of ["raise", "tiers", "amount", "workly_linked", "telegram_bound", "organization_name"]) expect(json).not.toContain(forbidden);
      expect((await card(token, e.id, "?period=2025-09-01")).body.period).toBe("2025-09-01");
    });

    it("чужой филиал, несуществующий и не uuid неотличимы: 404 not_found; мусорный месяц — 422", async () => {
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const mine = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const other = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const token = await evSession(db, ev.id);
      const notFound = { status: 404, body: { error: "not_found" } };
      expect(await card(token, other.id)).toEqual(notFound);
      expect(await card(token, randomUUID())).toEqual(notFound);
      expect(await card(token, "not-a-uuid")).toEqual(notFound);
      expect(await card(token, mine.id, "?period=2025-9")).toEqual({ status: 422, body: { error: "bad_period" } });
    });

    it("сессия: без токена 401; только сотрудник — 403 not_evaluator", async () => {
      const t1 = await makeTerminal(db);
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      expect(await card(null, e.id)).toEqual({ status: 401, body: { error: "unauthorized" } });
      const empToken = (await tgLogin((await bindTelegram(db, { employee_id: e.id })).telegram_id)).body.token;
      expect(await card(empToken, e.id)).toEqual({ status: 403, body: { error: "not_evaluator" } });
    });

    it("менеджер филиала без пользователя: видит карточки сотрудников своего филиала, но не чужого и не свою", async () => {
      const t = await makeTerminal(db);
      const mgr = await makeEmployee(db, { role_code: "manager", terminal_id: t.id });
      const login = await tgLogin((await bindTelegram(db, { employee_id: mgr.id })).telegram_id);
      expect(login.body.roles).toEqual(["employee", "evaluator"]);
      const token = login.body.token as string;
      const cook = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const r = await card(token, cook.id);
      expect(r.status).toBe(200);
      expect(r.body.employee.id).toBe(cook.id);
      const notFound = { status: 404, body: { error: "not_found" } };
      expect(await card(token, foreign.id)).toEqual(notFound);
      expect(await card(token, mgr.id)).toEqual(notFound);
    });

    it("отправленная оценка попадает в карточку: балл, статус, пункты", async () => {
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string; items: { id: string }[] }[];
      const cook = cards.find((c) => c.code === "cook")!;
      await seedReview(db, { employee_id: e.id, terminal_id: e.terminal_id, card_id: cook.id, evaluator_user_id: ev.id, period: "2025-10-01", scores: cook.items.map(() => 100) });
      const r = await card(await evSession(db, ev.id), e.id);
      expect(r.status).toBe(200);
      expect(r.body.review).toMatchObject({ score_pct: 100, status: "ready" });
      expect(r.body.review.items).toHaveLength(cook.items.length);
      expect(Object.keys(r.body.review.items[0]).sort()).toEqual(["note", "score", "title_ru", "title_uz"]);
    });
  });
}
