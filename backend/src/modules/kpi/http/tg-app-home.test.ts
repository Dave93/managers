import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app home (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, expectIsoTimestamps, fakeBotApi, makeEmployee, makeScope, makeUser, setNow, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } =
    await import("./fixtures");
  const { kpi_disputes, kpi_periods } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedDecision, seedDispute, seedReview, seedViolation } = await import("../tg-app/dev-data");
  const { iso } = await import("../iso");
  const { eq, inArray } = await import("drizzle-orm");

  const login = async (b: { telegram_id: number }) => (await tgLogin(b.telegram_id)).body.token as string;

  describe("kpi: главный экран и история мини-приложения", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;
    let cookCardId: string;
    let seniorCardId: string;
    let cookItems: string[];
    let ev: { id: string };
    const base = (e: { id: string; terminal_id: string }, card = cookCardId) => ({
      employee_id: e.id,
      terminal_id: e.terminal_id,
      card_id: card,
      evaluator_user_id: ev.id,
    });

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      const hr = await withSession({ permissions: ["kpi.manage"] });
      // Шкала явно: чужой тест со своей шкалой не должен менять ожиданий.
      const tiers = await api(hr, "PUT", "/api/kpi/raise-tiers", {
        tiers: [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }],
      });
      expect(tiers.status).toBe(200);
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string; items: { id: string }[] }[];
      const cook = cards.find((c) => c.code === "cook")!;
      cookCardId = cook.id;
      seniorCardId = cards.find((c) => c.code === "senior_cook")!.id;
      cookItems = cook.items.map((i) => i.id); // уже по sort
      ev = await makeUser(db);
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

    it("оценённый отчётный месяц: потерянные баллы, подсказка k < min, черновик не мешает", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 90, 75, 100] });
      await seedReview(db, { ...base(e), period: "2025-11-01", scores: [100, 100, 100, 100, 100, 100, 100], status: "draft" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const h = (await tgApi(token, "GET", "/api/kpi/tg/home")).body;
      expect([h.roles, h.evaluator, h.employee.has_card, h.employee.pending]).toEqual([["employee"], null, true, null]);
      expect(h.employee.month).toMatchObject({ period: "2025-10-01", score_pct: 91.43, status: "ready",
        dispute: { state: "can", deadline: "2025-11-10T18:59:59.999Z", opened_at: null, last_resolved: null } });
      expect(h.employee.month.lost.map((x: any) => [x.title_ru, x.score])).toEqual([["Гигиена сотрудника", 75], ["Соблюдение техкарты", 75], ["Время и скорость приготовления заказа", 90]]);
      expect(h.employee.raise).toMatchObject({ quarter_start: "2025-10-01", avg_pct: 91.43,
        tiers: [{ min_pct: 85, amount: 150000 }, { min_pct: 90, amount: 300000 }, { min_pct: 95, amount: 500000 }],
        hint: { kind: "too_few", scored: 1, amount: 300000, next: { amount: 500000, reachable: true, need_pct: 96.8, periods: ["2025-11-01", "2025-12-01"] } } });
      expect(h.employee.raise.months.map((m: any) => m.state)).toEqual(["scored", "upcoming", "upcoming"]);
      // Тело проверяем: на неизвестный роут Elysia тоже ответил бы 404.
      expect(await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-11-01")).toEqual({ status: 404, body: { error: "not_found" } });
      // Черновик ноября не попадает и в историю: иначе ноябрь был бы «scored».
      const hist = (await tgApi(token, "GET", "/api/kpi/tg/history")).body;
      expect(hist.quarters.map((q: any) => [q.quarter_start, q.months.map((m: any) => m.state), q.avg_pct])).toEqual([
        ["2025-10-01", ["scored", "upcoming", "upcoming"], 91.43],
      ]);
    });

    it("отчётный месяц не оценён: короткая карточка и прошлый месяц, нарушения только действующие", async () => {
      setNow("2025-11-10T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      for (const status of ["active", "active", "cancelled"] as const) {
        await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-11-01", occurred_at: "2025-11-03T07:00:00.000Z", status });
      }
      const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
      expect(h.pending).toEqual({ period: "2025-11-01", submit_opens_at: "2025-11-19T19:00:00.000Z", review_deadline: "2025-12-07T18:59:59.999Z", violations: 2 });
      expect([h.month.period, h.month.lost, h.violations]).toEqual(["2025-10-01", [], { period: "2025-10-01", count: 0 }]);
      expectIsoTimestamps(h, ["submit_opens_at", "review_deadline", "opens_at"]);
    });

    it("отчётный месяц отправлен без балла: карточка этого месяца с прочерком, короткой карточки нет", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-10-01", scores: [null, null, null, null, null, null, null] });
      const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
      expect([h.pending, h.month.period, h.month.score_pct, h.month.lost]).toEqual([null, "2025-10-01", null, []]);
      expect([h.raise.months[0].state, h.raise.hint]).toEqual(["not_rated", { kind: "none" }]);
    });

    it("новый квартал без оценок: карточка прошлого — ждём HR, потом решение; первая оценка переключает", async () => {
      setNow("2026-01-12T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 90, 75, 100] }); // 91.43
      await seedReview(db, { ...base(e), period: "2025-11-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const raise = async () => (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee.raise;
      expect(await raise()).toMatchObject({ quarter_start: "2025-10-01", avg_pct: 95.72, hint: { kind: "waiting_hr", amount: 500000 } });
      expect((await raise()).months.map((m: any) => m.state)).toEqual(["scored", "scored", "not_rated"]);
      await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [91.43, 100, null], status: "approved", amount: 300000, comment: "HR-секрет" });
      expect((await raise()).hint).toEqual({ kind: "decided", amount: 300000 });
      await seedReview(db, { ...base(e), period: "2026-01-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      expect(await raise()).toMatchObject({ quarter_start: "2026-01-01", hint: { kind: "too_few" } });
    });

    // Прошлый месяц без оценки ещё можно оценить с опозданием, пока HR его не закрыл: «прибавки не будет» рано.
    it("impossible только когда прошлые неоценённые месяцы закрыты", async () => {
      setNow("2025-12-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-12-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const raise = async () => (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee.raise;
      const open = await raise();
      expect([open.quarter_start, open.months.map((m: any) => m.state)]).toEqual(["2025-10-01", ["not_rated", "not_rated", "scored"]]);
      expect(open.hint).toEqual({ kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2025-12-01"], amount: 500000, next: null });
      try {
        await db.insert(kpi_periods).values({ period: "2025-11-01", status: "closed" });
        expect((await raise()).hint.kind).toBe("too_few"); // октябрь ещё открыт
        await db.insert(kpi_periods).values({ period: "2025-10-01", status: "closed" });
        expect((await raise()).hint).toEqual({ kind: "impossible", scored: 1, min_months: 2 });
      } finally {
        await db.delete(kpi_periods).where(inArray(kpi_periods.period, ["2025-10-01", "2025-11-01"]));
      }
    });

    it("руководитель с двумя привязками: карточка оценщика и своё; ссылка в админку из KPI_ADMIN_URL", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await makeEmployee(db, { role_code: "cook", terminal_id: e.terminal_id });
      const u = await makeUser(db);
      await makeScope(db, u.id, { terminal_id: e.terminal_id });
      const b = await bindTelegram(db, { employee_id: e.id });
      await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
      process.env.KPI_ADMIN_URL = "https://admin.example.test/";
      try {
        const h = (await tgApi(await login(b), "GET", "/api/kpi/tg/home")).body;
        expect(h.roles).toEqual(["employee", "evaluator"]);
        expect(h.evaluator).toEqual({ period: "2025-10-01", pending: 2, review_deadline: "2025-11-07T18:59:59.999Z", admin_url: "https://admin.example.test/ru/kpi/reviews" });
        expect(h.employee.pending.period).toBe("2025-10-01");
      } finally { delete process.env.KPI_ADMIN_URL; }
    });

    it("оценщик без привязки сотрудника: employee = null, история — 403 not_employee; без KPI_ADMIN_URL ссылки нет", async () => {
      const u = await makeUser(db);
      const token = await login(await bindTelegram(db, { user_id: u.id }));
      const h = (await tgApi(token, "GET", "/api/kpi/tg/home")).body;
      expect([h.roles, h.employee, h.evaluator.admin_url]).toEqual([["evaluator"], null, null]);
      expect((await tgApi(token, "GET", "/api/kpi/tg/history")).body).toEqual({ error: "not_employee" });
    });

    it("без карты: месяц и прибавка пусты, история есть", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "hall_worker" });
      await seedReview(db, { ...base(e), period: "2025-07-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const h = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/home")).body.employee;
      expect([h.has_card, h.pending, h.month, h.raise, h.has_history]).toEqual([false, null, null, null, true]);
    });

    it("история: не больше 4 кварталов, пустые пропущены, итоги и состояния месяцев; proposed — не решение", async () => {
      setNow("2026-01-12T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const all100 = [100, 100, 100, 100, 100, 100, 100];
      for (const period of ["2025-01-01", "2025-07-01", "2025-10-01", "2025-11-01"]) await seedReview(db, { ...base(e), period, scores: all100 });
      await seedDecision(db, { quarter_start: "2025-07-01", employee_id: e.id, months: [100, null, null], status: "rejected", comment: "HR-секрет" });
      await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [100, 100, null], status: "proposed" }); // «Рассчитать» — ещё не решение
      const hist = (await tgApi(await login(await bindTelegram(db, { employee_id: e.id })), "GET", "/api/kpi/tg/history")).body;
      expect(hist.quarters.map((q: any) => [q.quarter_start, q.result, q.avg_pct])).toEqual([
        ["2026-01-01", { kind: "running" }, null],
        ["2025-10-01", { kind: "waiting_hr" }, 100],
        ["2025-07-01", { kind: "decided", amount: 0 }, 100],
      ]);
      expect(hist.quarters.map((q: any) => q.months.map((m: any) => m.state))).toEqual([
        ["upcoming", "upcoming", "upcoming"], ["scored", "scored", "not_rated"], ["scored", "not_rated", "not_rated"],
      ]);
    });

    it("в ответах нет id оценщика и комментария HR", async () => {
      setNow("2026-01-12T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 90] });
      await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [98.57, null, null], status: "approved", amount: 150000, comment: "HR-секрет" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const text = JSON.stringify([(await tgApi(token, "GET", "/api/kpi/tg/home")).body, (await tgApi(token, "GET", "/api/kpi/tg/history")).body]);
      expect(text).not.toContain(ev.id);
      expect(text).not.toContain("HR-секрет");
    });

    // Решение 12 и 13 на карточке месяца; F4 на главном экране. Тест последний: закрывает месяц и сам же открывает.
    it("карточка месяца: изменена → спор разобран → спор открыт; окно спора и закрытый месяц; proposed — не решение", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const r = await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 100, 100, 100],
        change: { old_score_pct: 90, comment: "Пересчитали гигиену" } });
      expect(r.item_ids).toEqual(cookItems);
      await seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [r.score_pct, null, null], status: "proposed" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const home = async () => (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee;
      let h = await home();
      expect([h.month.status, h.month.dispute.state, h.raise.hint.kind]).toEqual(["changed", "can", "too_few"]);

      await seedDispute(db, { subject_type: "review", subject_id: r.id, employee_id: e.id, period: "2025-10-01", status: "rejected", resolution_comment: "Оценка верная" });
      h = await home();
      expect([h.month.status, h.month.dispute.state, h.month.dispute.opened_at]).toEqual(["dispute_resolved", "can", null]);
      expect(h.month.dispute.last_resolved).toEqual({ decision: "rejected", comment: "Оценка верная", resolved_at: expect.any(String) });
      expectIsoTimestamps(h.month, ["resolved_at"]);

      const d = await seedDispute(db, { subject_type: "review", subject_id: r.id, employee_id: e.id, period: "2025-10-01" });
      const [row] = await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, d.id));
      h = await home();
      expect([h.month.status, h.month.dispute.state, h.month.dispute.opened_at]).toEqual(["dispute_open", "open", iso(row.created_at)]);

      // Окно спора за октябрь вышло 10 ноября; закрытый месяц важнее вышедшего окна.
      const other = await makeEmployee(db, { role_code: "cook" });
      await seedReview(db, { ...base(other), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const t2 = await login(await bindTelegram(db, { employee_id: other.id }));
      setNow("2025-11-12T10:00:00+05:00");
      const month2 = async () => (await tgApi(t2, "GET", "/api/kpi/tg/home")).body.employee.month;
      expect([(await month2()).period, (await month2()).dispute.state]).toEqual(["2025-10-01", "window_closed"]);
      await db.insert(kpi_periods).values({ period: "2025-10-01", status: "closed" });
      try {
        expect((await month2()).dispute.state).toBe("period_closed");
      } finally {
        await db.delete(kpi_periods).where(eq(kpi_periods.period, "2025-10-01"));
      }
    });

    // F13: прямые записи мимо доменных проверок — только в тестах и на smoke-стенде. Отказ раньше любого запроса.
    it("dev-data: под боевым PROJECT_PREFIX каждый seed* отказывает", async () => {
      const e = await makeEmployee(db, { role_code: "cook" });
      const prevPrefix = process.env.PROJECT_PREFIX;
      const msg = "dev-data: только managers_test_ и managers_smoke_";
      for (const prefix of ["managers_", undefined]) {
        if (prefix === undefined) delete process.env.PROJECT_PREFIX;
        else process.env.PROJECT_PREFIX = prefix;
        try {
          await expect(seedReview(db, { ...base(e), period: "2025-10-01", scores: [] })).rejects.toThrow(msg);
          await expect(seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-03T07:00:00.000Z" })).rejects.toThrow(msg);
          await expect(seedDispute(db, { subject_type: "review", subject_id: e.id, employee_id: e.id, period: "2025-10-01" })).rejects.toThrow(msg);
          await expect(seedDecision(db, { quarter_start: "2025-10-01", employee_id: e.id, months: [], status: "proposed" })).rejects.toThrow(msg);
        } finally {
          if (prevPrefix === undefined) delete process.env.PROJECT_PREFIX;
          else process.env.PROJECT_PREFIX = prevPrefix;
        }
      }
    });

    it("KPI_ADMIN_URL: только схема и хост, хвостовой / срезается; иначе ссылки нет", async () => {
      const { adminReviewsUrl } = await import("../tg-app/home");
      const prev = process.env.KPI_ADMIN_URL;
      const cases: [string | undefined, string | null][] = [
        ["https://admin.example.test", "https://admin.example.test/ru/kpi/reviews"],
        ["http://localhost:6762/", "http://localhost:6762/ru/kpi/reviews"],
        [undefined, null],
        ["", null],
        ["admin.example.test", null],
        ["ftp://admin.example.test", null],
        ["https://admin.example.test/ru", null],
        ["https://admin.example.test?x=1", null],
        ["javascript:alert(1)", null],
      ];
      try {
        for (const [v, want] of cases) {
          if (v === undefined) delete process.env.KPI_ADMIN_URL;
          else process.env.KPI_ADMIN_URL = v;
          expect([v, adminReviewsUrl()]).toEqual([v, want]);
        }
      } finally {
        if (prev === undefined) delete process.env.KPI_ADMIN_URL;
        else process.env.KPI_ADMIN_URL = prev;
      }
    });
  });
}
