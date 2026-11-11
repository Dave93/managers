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
  const { cash_shift_cashier_dishes, cash_shift_cashiers, cash_shifts, employees } = await import("backend/drizzle/schema");
  const { eq, inArray } = await import("drizzle-orm");

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

    const shifts: string[] = [];
    async function shift(terminal_id: string, day: string, cashier_id: string, orders_count: number, revenue: number, dishes: { id: string; name: string; qty: number }[] = []): Promise<void> {
      const id = randomUUID();
      shifts.push(id);
      await db.insert(cash_shifts).values({ id, terminal_id, point_of_sale_id: randomUUID(), cash_reg_number: 1, session_number: 1, open_at: `${day}T05:00:00+05:00`, business_date: day, status: "CLOSED" });
      await db.insert(cash_shift_cashiers).values({ shift_id: id, cashier_id, cashier_name: "Baxrom", orders_count, revenue: String(revenue) });
      for (const d of dishes) await db.insert(cash_shift_cashier_dishes).values({ shift_id: id, cashier_id, dish_id: d.id, dish_type: "GOODS", dish_name: d.name, qty: String(d.qty), revenue: String(d.qty * 10_000) });
    }

    afterAll(async () => {
      if (shifts.length) await db.delete(cash_shifts).where(inArray(cash_shifts.id, shifts));
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
      expect(r.body).toMatchObject({ period: "2025-10-01", employee: { id: e.id, terminal_name: t1.name, active: true }, review: null, violations: [], days: [], sales: null });
      expect(Object.keys(r.body).sort()).toEqual(["days", "employee", "history", "months", "period", "review", "sales", "violations"]);
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

    it("кассир привязан: чеки и средний чек за месяц, прошлый месяц и дни; без привязки — sales null", async () => {
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      const c = randomUUID();
      // два дня в октябре (в одном — две смены, одна в чужом филиале: кассир один человек), один день в сентябре
      await shift(t1.id, "2025-10-03", c, 30, 3_000_000);
      await shift(t1.id, "2025-10-03", c, 10, 1_050_000);
      await shift(t2.id, "2025-10-04", c, 20, 2_000_001);
      await shift(t1.id, "2025-09-30", c, 8, 960_000);
      await shift(t1.id, "2025-11-01", c, 99, 9_999_999); // следующий месяц в ответ не попадает
      expect((await card(token, e.id)).body.sales).toBeNull();
      await db.update(employees).set({ iiko_cashier_id: c }).where(eq(employees.id, e.id));
      const r = await card(token, e.id);
      expect(r.status).toBe(200);
      expect(r.body.sales).toEqual({
        cashier_name: "Baxrom",
        month: { checks: 60, avg_check: 100_833, days: 2 },
        prev: { checks: 8, avg_check: 120_000, days: 1 },
        days: [
          { day: "2025-10-03", checks: 40, avg_check: 101_250 },
          { day: "2025-10-04", checks: 20, avg_check: 100_000 },
        ],
        products: [],
      });
    });

    it("кассир привязан: проданные позиции за месяц по убыванию штук, штук на 100 чеков, прошлый месяц; чужой кассир не мешает", async () => {
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const c = randomUUID(), other = randomUUID();
      const cola = randomUUID(), sous = randomUUID(), pizza = randomUUID(), old = randomUUID();
      // 40 + 20 чеков в октябре; позиции суммируются по сменам (в том числе чужого филиала), прошлый месяц считается отдельно
      await shift(t1.id, "2025-10-03", c, 40, 4_000_000, [{ id: cola, name: "Cola 1L", qty: 12 }, { id: sous, name: "Sous", qty: 3 }, { id: pizza, name: "Pizza", qty: 3 }]);
      await shift(t2.id, "2025-10-04", c, 20, 2_000_000, [{ id: cola, name: "Cola 1L", qty: 6 }]);
      await shift(t1.id, "2025-09-30", c, 8, 960_000, [{ id: cola, name: "Cola 1L", qty: 5 }, { id: old, name: "Только в сентябре", qty: 9 }]);
      await shift(t1.id, "2025-10-05", other, 50, 5_000_000, [{ id: sous, name: "Sous", qty: 100 }]);
      await db.update(employees).set({ iiko_cashier_id: c }).where(eq(employees.id, e.id));
      const r = await card(await evSession(db, ev.id), e.id);
      expect(r.status).toBe(200);
      expect(r.body.sales.products).toEqual([
        { name: "Cola 1L", qty: 18, per100: 30, prev_qty: 5 },
        { name: "Pizza", qty: 3, per100: 5, prev_qty: 0 },
        { name: "Sous", qty: 3, per100: 5, prev_qty: 0 },
      ]);
    });

    it("кассир есть, но смен в месяце нет: нули, средний чек null", async () => {
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const c = randomUUID();
      await shift(t1.id, "2025-06-10", c, 5, 500_000);
      await db.update(employees).set({ iiko_cashier_id: c }).where(eq(employees.id, e.id));
      const r = await card(await evSession(db, ev.id), e.id);
      expect(r.body.sales).toEqual({ cashier_name: null, month: { checks: 0, avg_check: null, days: 0 }, prev: { checks: 0, avg_check: null, days: 0 }, days: [], products: [] });
    });
  });
}
