import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-ev-card.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: время приготовления (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { addOrder, bindTelegram, cleanupKpi, evSession, fakeBotApi, makeEmployee, makeEvaluator, makeScope, makeTerminal, setNow, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { cash_shifts, productCookingTime } = await import("backend/drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const { loadIndicators } = await import("../branch-settings");

  describe("kpi: оценщик в мини-приложении, время приготовления", () => {
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
    afterAll(async () => {
      if (shifts.length) await db.delete(cash_shifts).where(inArray(cash_shifts.id, shifts));
      setNow(null);
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    // Заказ с одним ожиданием на все строки. Время заказа и строк одно: join по open_date_typed.
    async function order(iiko: string, day: string, time: string, wait: number, lines: { dish: string; qty: number; place?: string }[], type: string | null = "COMMON"): Promise<void> {
      const id = await addOrder(db, { iiko_id: iiko, day, sum: 1000, service_type: type, time });
      const at = `${day} ${time}`;
      await db.insert(productCookingTime).values(
        lines.map((l) => ({ uniqOrderId: id, restorauntGroup: iiko.toUpperCase(), department: "kpi_test", departmentId: "kpi_test", cookingPlace: l.place ?? "kitchen", dishName: l.dish, openTime: at, cookingFinishTime: at, dishAmountInt: l.qty, guestWaitTimeAvg: wait, openDateTyped: at }))
      );
    }
    async function cashShift(iiko: string, day: string, from: string, to: string, reg = 1): Promise<void> {
      const id = randomUUID();
      shifts.push(id);
      await db.insert(cash_shifts).values({ id, iiko_group_id: iiko, point_of_sale_id: randomUUID(), cash_reg_number: reg, session_number: reg, open_at: `${day}T${from}+05:00`, close_at: `${day}T${to}+05:00`, business_date: day, status: "CLOSED" });
    }

    const cooking = (token: string | null, id: string, q = "") => tgApi(token, "GET", `/api/kpi/tg/ev/employees/${id}/cooking${q}`);

    async function branch() {
      const t = await makeTerminal(db, { iiko_id: randomUUID() });
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      return { t, e, token: await evSession(db, ev.id) };
    }

    it("итог как у балла филиала, дни и блюда; зал, мелкие блюда и чужой месяц не входят", async () => {
      const { t, e, token } = await branch();
      const g = t.iiko_id as string;
      await order(g, "2025-10-10", "09:00:00", 400, [{ dish: "Пицца", qty: 4 }, { dish: "Паста", qty: 2 }, { dish: "Лимонад", qty: 3, place: "Кухня Зал" }]); // в норматив зала 8 мин
      await order(g, "2025-10-10", "15:00:00", 600, [{ dish: "Пицца", qty: 3 }]); // дольше норматива
      await order(g, "2025-10-11", "12:00:00", 700, [{ dish: "Пицца", qty: 2 }], "DELIVERY_BY_COURIER"); // норматив доставки 12 мин
      await order(g, "2025-09-30", "12:00:00", 900, [{ dish: "Пицца", qty: 9 }]); // прошлый месяц
      const r = await cooking(token, e.id, "?period=2025-10-01");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ period: "2025-10-01", shift: null, shifts: false, norms: { hall_min: 8, delivery_min: 12 }, min_qty: 5, employee: { id: e.id, terminal_name: t.name } });
      // Медиана месяца — по всем трём заказам (400, 600, 700), а не из медиан дней
      expect(r.body.summary).toEqual({ orders: 3, on_time: 2, avg_wait_sec: 567, median_wait_sec: 600 });
      expect(r.body.days).toEqual([
        { day: "2025-10-10", orders: 2, on_time: 1, avg_wait_sec: 500, median_wait_sec: 500 },
        { day: "2025-10-11", orders: 1, on_time: 1, avg_wait_sec: 700, median_wait_sec: 700 },
      ]);
      // Пицца: (400·4 + 600·3 + 700·2) / 9 = 533, дольше норматива 3 из 9; Паста (2 шт.) и Лимонад (зал) не показаны
      expect(r.body.dishes).toEqual([{ name: "Пицца", qty: 9, avg_wait_sec: 533, over_pct: 33.3 }]);
      expect(r.body.data_issue).toBeNull();
      // Пороги показателя «Заказы в норматив» — из настроек балла филиала
      const service = (await loadIndicators(db)).find((i) => i.code === "service" && i.active);
      expect(r.body.scale).toEqual(service ? { floor: service.floor, target: service.target } : null);
    });

    it("филиал без отдельной кухни в iiko: блюда считаются по залу, данные помечены no_kitchen", async () => {
      const { t, e, token } = await branch();
      const g = t.iiko_id as string;
      await order(g, "2025-10-10", "09:00:00", 400, [{ dish: "Пицца", qty: 3, place: "21027 Chopar 40 Зал" }]);
      await order(g, "2025-10-11", "10:00:00", 450, [{ dish: "Пицца", qty: 2, place: "21027 Chopar 40 Зал" }]);
      const r = await cooking(token, e.id, "?period=2025-10-01");
      // (400·3 + 450·2) / 5 = 420, оба заказа в норматив зала 8 мин
      expect(r.body.dishes).toEqual([{ name: "Пицца", qty: 5, avg_wait_sec: 420, over_pct: 0 }]);
      expect(r.body.data_issue).toBe("no_kitchen");
    });

    it("обычное ожидание больше двух нормативов: данные помечены too_slow", async () => {
      const { t, e, token } = await branch();
      const g = t.iiko_id as string;
      await order(g, "2025-10-10", "09:00:00", 3000, [{ dish: "Пицца", qty: 1 }]); // зал: 50 мин при нормативе 8
      await order(g, "2025-10-10", "12:00:00", 3600, [{ dish: "Пицца", qty: 1 }]);
      await order(g, "2025-10-11", "12:00:00", 300, [{ dish: "Пицца", qty: 1 }]);
      const r = await cooking(token, e.id, "?period=2025-10-01");
      expect(r.body.summary).toMatchObject({ orders: 3, on_time: 1, median_wait_sec: 3000 });
      expect(r.body.data_issue).toBe("too_slow");
    });

    it("смена: 1-я и 2-я по кассовым сменам iiko, без смен переключатель выключен", async () => {
      const { t, e, token } = await branch();
      const g = t.iiko_id as string;
      expect((await cooking(token, e.id, "?period=2025-10-01&shift=1")).body).toMatchObject({ shifts: false, shift: null });
      await cashShift(g, "2025-10-10", "05:00:00", "13:00:00");
      await cashShift(g, "2025-10-10", "13:00:00", "23:00:00", 1);
      await order(g, "2025-10-10", "09:00:00", 400, [{ dish: "Пицца", qty: 6 }]);
      await order(g, "2025-10-10", "15:00:00", 800, [{ dish: "Пицца", qty: 7 }]);
      const all = await cooking(token, e.id, "?period=2025-10-01");
      expect(all.body).toMatchObject({ shifts: true, shift: null });
      expect(all.body.summary.orders).toBe(2);
      const one = await cooking(token, e.id, "?period=2025-10-01&shift=1");
      expect(one.body).toMatchObject({ shift: "1", shifts: true, summary: { orders: 1, on_time: 1, avg_wait_sec: 400, median_wait_sec: 400 }, dishes: [{ name: "Пицца", qty: 6, avg_wait_sec: 400, over_pct: 0 }] });
      const two = await cooking(token, e.id, "?period=2025-10-01&shift=2");
      expect(two.body).toMatchObject({ shift: "2", summary: { orders: 1, on_time: 0, avg_wait_sec: 800, median_wait_sec: 800 }, dishes: [{ name: "Пицца", qty: 7, avg_wait_sec: 800, over_pct: 100 }] });
    });

    it("филиал без связи с iiko и месяц без заказов: пустой ответ, не ошибка", async () => {
      const t = await makeTerminal(db, { iiko_id: null });
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const r = await cooking(await evSession(db, ev.id), e.id, "?period=2025-10-01");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ summary: null, days: [], dishes: [], shifts: false, data_issue: null });
      const b = await branch();
      expect((await cooking(b.token, b.e.id, "?period=2025-10-01")).body).toMatchObject({ summary: null, days: [], dishes: [], data_issue: null });
    });

    it("чужой, несуществующий и не uuid — 404; мусорные месяц и смена — 422; без токена 401; сотрудник — 403", async () => {
      const { e: mine, token } = await branch();
      const other = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const notFound = { status: 404, body: { error: "not_found" } };
      expect(await cooking(token, other.id, "?period=2025-10-01")).toEqual(notFound);
      expect(await cooking(token, randomUUID(), "?period=2025-10-01")).toEqual(notFound);
      expect(await cooking(token, "not-a-uuid", "?period=2025-10-01")).toEqual(notFound);
      expect(await cooking(token, mine.id)).toEqual({ status: 422, body: { error: "bad_period" } });
      expect(await cooking(token, mine.id, "?period=2025-9")).toEqual({ status: 422, body: { error: "bad_period" } });
      expect(await cooking(token, mine.id, "?period=2025-10-01&shift=3")).toEqual({ status: 422, body: { error: "bad_shift" } });
      expect(await cooking(null, mine.id, "?period=2025-10-01")).toEqual({ status: 401, body: { error: "unauthorized" } });
      const empToken = (await tgLogin((await bindTelegram(db, { employee_id: mine.id })).telegram_id)).body.token;
      expect(await cooking(empToken, mine.id, "?period=2025-10-01")).toEqual({ status: 403, body: { error: "not_evaluator" } });
    });
  });
}
