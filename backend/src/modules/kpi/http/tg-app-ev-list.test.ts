import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: список (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const {
    api,
    bindTelegram,
    cleanupKpi,
    evSession,
    fakeBotApi,
    makeEmployee,
    makeEvaluator,
    makeScope,
    makeTerminal,
    setNow,
    setup,
    tgApi,
    tgLogin,
    TG_TEST_BOT_TOKEN,
  } = await import("./fixtures");
  const { kpi_evaluator_scopes, kpi_tg_bindings } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedReview } = await import("../tg-app/dev-data");
  const { eq } = await import("drizzle-orm");

  describe("kpi: оценщик в мини-приложении, список сотрудников", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;
    let cookCardId: string;
    let cookItems: string[];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string; items: { id: string }[] }[];
      const cook = cards.find((c) => c.code === "cook")!;
      cookCardId = cook.id;
      cookItems = cook.items.map((i) => i.id); // уже по sort
    }, 180000);

    beforeEach(() => {
      setTestBotApi(fakeBotApi().api);
    });

    afterAll(async () => {
      // Все файлы http/ идут одним процессом: подмена времени не должна пережить файл.
      setNow(null);
      // undefined в process.env стал бы строкой "undefined", и botApi() в следующих файлах пошёл бы в Telegram.
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    const base = (ev: { id: string }, e: { id: string; terminal_id: string }) =>
      ({ employee_id: e.id, terminal_id: e.terminal_id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01" as const });

    it("список: только покрытые назначением, статусы, справочники фильтров", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const a = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // черновик
      const b = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // без оценки
      const c = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });          // отправлена
      const out = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });        // чужой филиал
      const nocard = await makeEmployee(db, { role_code: "hall_worker", terminal_id: t1.id }); // без карты
      const all100 = cookItems.map(() => 100);
      await seedReview(db, { ...base(ev, a), scores: all100, status: "draft" });
      await seedReview(db, { ...base(ev, c), scores: all100 });
      const token = await evSession(db, ev.id);
      const r = await tgApi(token, "GET", "/api/kpi/tg/ev/employees");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        period: "2025-10-01", period_status: "open",
        submit_opens_at: "2025-10-19T19:00:00.000Z", review_deadline: "2025-11-07T18:59:59.999Z",
        terminals: [{ id: t1.id, name: t1.name }],
        cards: [{ id: cookCardId, title: "Повар (Chopar и Les Ailes)" }],
      });
      const byId = new Map<string, any>(r.body.items.map((i: any) => [i.id, i]));
      expect([...byId.keys()].sort()).toEqual([a.id, b.id, c.id].sort());
      expect(byId.get(a.id)).toMatchObject({ review_status: "draft", score_pct: null, can_evaluate: true, late: false, open_dispute: false, terminal_id: t1.id });
      expect(byId.get(b.id)).toMatchObject({ review_status: "none", score_pct: null });
      expect(byId.get(c.id)).toMatchObject({ review_status: "submitted", score_pct: 100 });
      expect(byId.has(out.id) || byId.has(nocard.id)).toBe(false);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees?period=2025-09-01")).body.period).toBe("2025-09-01");
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/employees?period=2025-9")).toEqual({ status: 422, body: { error: "bad_period" } });
    });

    it("роль с kpi.approve, kpi.view и kpi.manage видит в приложении только своё назначение", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const mine = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const other = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve", "kpi.view", "kpi.manage"] });
      await makeScope(db, hr.id, { terminal_id: t1.id });
      const r = await tgApi(await evSession(db, hr.id), "GET", "/api/kpi/tg/ev/employees");
      const ids = r.body.items.map((i: any) => i.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(other.id);
    });

    it("сессия: без токена 401; только сотрудник — 403 not_evaluator; без права — 403 forbidden; после отвязки 401", async () => {
      expect(await tgApi(null, "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 401, body: { error: "unauthorized" } });
      const emp = await makeEmployee(db, { role_code: "cook" });
      const empToken = (await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).body.token;
      expect(await tgApi(empToken, "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 403, body: { error: "not_evaluator" } });
      const viewer = await makeEvaluator(db, { perms: ["kpi.view"] });
      expect(await tgApi(await evSession(db, viewer.id), "GET", "/api/kpi/tg/ev/employees")).toEqual({ status: 403, body: { error: "forbidden" } });
      const ev = await makeEvaluator(db);
      const b = await bindTelegram(db, { user_id: ev.id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).status).toBe(200);
      await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).status).toBe(401);
    });

    it("guard нового плагина не расползается: публичный вход и cookie-роуты админки работают", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "GET", "/api/kpi/me")).status).toBe(200);
      const emp = await makeEmployee(db, { role_code: "cook" });
      expect((await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).status).toBe(200);
    });

    it("снятое назначение действует со следующего запроса", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db);
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).body.items.map((i: any) => i.id)).toContain(e.id);
      await db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, ev.id));
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/employees")).body).toMatchObject({ items: [], terminals: [], cards: [] });
    });
  });
}
