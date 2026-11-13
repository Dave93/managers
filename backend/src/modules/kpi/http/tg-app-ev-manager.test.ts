import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

// Тот же guard, что в tg-app-ev-days-off.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app: менеджер филиала как оценщик (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const {
    api,
    bindTelegram,
    cleanupKpi,
    evSession,
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
  const { employee_twins, employees, kpi_days_off, kpi_reviews } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { fakeBotApi } = await import("./fixtures");
  const { eq } = await import("drizzle-orm");

  const NOW = "2025-10-26T10:00:00+05:00";
  const OUT = { status: 403, body: { error: "out_of_scope" } };

  describe("kpi: менеджер филиала оценивает без учётной записи", () => {
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
      setNow(NOW);
    });

    afterAll(async () => {
      setNow(null);
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    // Менеджер с привязанным Telegram как сотрудник, техничка, повар и сотрудник без карты его филиала, повар чужого филиала.
    // Менеджер оценивает только карту «Техничка»; повар нужен, чтобы проверить, что остальные карты ему недоступны.
    async function branch(role = "manager") {
      const t = await makeTerminal(db);
      const mgr = await makeEmployee(db, { role_code: role, terminal_id: t.id, first_name: "Тест Менеджер" });
      const b = await bindTelegram(db, { employee_id: mgr.id });
      const login = await tgLogin(b.telegram_id);
      const cleaner = await makeEmployee(db, { role_code: "cleaner", terminal_id: t.id });
      const cook = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const cardless = await makeEmployee(db, { terminal_id: t.id });
      const foreign = await makeEmployee(db, { role_code: "cleaner", terminal_id: (await makeTerminal(db)).id });
      return { t, mgr, b, login, token: login.body?.token as string, cleaner, cook, cardless, foreign };
    }

    it("менеджер без пользователя входит как оценщик: роль evaluator, карточка на главном без ссылки в админку", async () => {
      const w = await branch();
      expect(w.login.status).toBe(200);
      expect(w.login.body.roles).toEqual(["employee", "evaluator"]);
      const home = await tgApi(w.token, "GET", "/api/kpi/tg/home");
      expect(home.status).toBe(200);
      expect(home.body.roles).toEqual(["employee", "evaluator"]);
      expect(home.body.evaluator).toMatchObject({ admin_url: null });
      expect(typeof home.body.evaluator.pending).toBe("number");
    });

    it("стажёр-менеджер, повар и неактивный менеджер оценщиками не становятся", async () => {
      const trainee = await branch("trainee_manager");
      expect(trainee.login.body.roles).toEqual(["employee"]);
      expect((await tgApi(trainee.token, "GET", "/api/kpi/tg/ev/employees")).body).toEqual({ error: "not_evaluator" });
      expect((await tgApi(trainee.token, "GET", "/api/kpi/tg/ev/days-off/employees")).status).toBe(403);

      const cook = await branch("cook");
      expect(cook.login.body.roles).toEqual(["employee"]);

      const off = await branch();
      await db.update(employees).set({ active: false }).where(eq(employees.id, off.mgr.id));
      expect((await tgLogin(off.b.telegram_id)).status).toBe(403);
      // Сессия, выданная до увольнения, закрывается сразу
      expect((await tgApi(off.token, "GET", "/api/kpi/tg/ev/employees")).status).toBe(401);
    });

    it("список: только техничка своего филиала; повар, он сам, сотрудник без карты и чужой филиал не попадают", async () => {
      const w = await branch();
      const r = await tgApi(w.token, "GET", "/api/kpi/tg/ev/employees?period=2025-10-01");
      expect(r.status).toBe(200);
      const ids = r.body.items.map((x: { id: string }) => x.id);
      expect(ids).toEqual([w.cleaner.id]);
      expect(r.body.items.find((x: { id: string }) => x.id === w.cleaner.id).can_evaluate).toBe(true);
    });

    it("форма, черновик и отправка: подпись id сотрудника-менеджера; повара, себя и чужой филиал оценивать нельзя", async () => {
      const w = await branch();
      const form = (id: string) => tgApi(w.token, "GET", `/api/kpi/tg/ev/form?period=2025-10-01&employee_id=${id}`);
      const f = await form(w.cleaner.id);
      expect(f.status).toBe(200);
      expect(f.body.can_edit).toBe(true);
      const items = f.body.items.map((i: { item_id: string; source: string }) => ({ item_id: i.item_id, score: i.source === "manual" ? 100 : null }));
      const d = await tgApi(w.token, "PUT", "/api/kpi/tg/ev/draft", { period: "2025-10-01", employee_id: w.cleaner.id, items });
      expect(d.status).toBe(200);
      const [row] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, d.body.review.id));
      expect(row.evaluator_user_id).toBe(w.mgr.id);
      const s = await tgApi(w.token, "POST", `/api/kpi/tg/ev/reviews/${d.body.review.id}/submit`, {});
      expect(s.status).toBe(200);
      expect(s.body.review.status).toBe("submitted");

      expect((await form(w.cook.id)).status).toBe(403);
      expect((await form(w.mgr.id)).status).toBe(403);
      expect((await form(w.foreign.id)).status).toBe(403);
      expect((await tgApi(w.token, "PUT", "/api/kpi/tg/ev/draft", { period: "2025-10-01", employee_id: w.mgr.id, items: [] })).status).toBe(403);
      expect((await tgApi(w.token, "PUT", "/api/kpi/tg/ev/draft", { period: "2025-10-01", employee_id: w.cook.id, items: [] })).status).toBe(403);
    });

    it("выходные: любому сотруднику филиала, в том числе без карты; себе и чужому — нет; список для выдачи без него самого", async () => {
      const w = await branch();
      const give = (id: string) => tgApi(w.token, "POST", "/api/kpi/tg/ev/days-off", { employee_id: id, from: "2025-10-27", to: "2025-10-27", reason_code: "sick" });
      expect((await give(w.cook.id)).status).toBe(200);
      expect((await give(w.cardless.id)).status).toBe(200);
      expect(await give(w.mgr.id)).toEqual(OUT);
      expect(await give(w.foreign.id)).toEqual(OUT);
      const [row] = await db.select().from(kpi_days_off).where(eq(kpi_days_off.employee_id, w.cook.id));
      expect(row.given_by).toBe(w.mgr.id);
      const list = await tgApi(w.token, "GET", "/api/kpi/tg/ev/days-off/employees");
      const ids = list.body.items.map((x: { id: string }) => x.id);
      expect(ids).toEqual(expect.arrayContaining([w.cook.id, w.cardless.id]));
      expect(ids).not.toContain(w.mgr.id);
      expect(ids).not.toContain(w.foreign.id);
      // Выданные им выходные видны ему же и отменяются им же
      const mine = await tgApi(w.token, "GET", "/api/kpi/tg/ev/days-off?period=2025-10-01");
      expect(mine.body.items).toHaveLength(2);
      expect((await tgApi(w.token, "POST", `/api/kpi/tg/ev/days-off/${mine.body.items[0].id}/cancel`)).status).toBe(200);
    });

    it("пара в другой компании (employee_twins): оценивает и её филиал, и пара тоже недоступна как «себя»; разорванная пара ничего не даёт", async () => {
      const w = await branch();
      const tB = await makeTerminal(db);
      const twin = await makeEmployee(db, { role_code: "manager", terminal_id: tB.id });
      const cleanerB = await makeEmployee(db, { role_code: "cleaner", terminal_id: tB.id });
      const [lo, hi] = w.mgr.id < twin.id ? [w.mgr.id, twin.id] : [twin.id, w.mgr.id];
      await db.insert(employee_twins).values({ employee_a: lo, employee_b: hi, rule: "name_birth", blocked: false });
      const ids = async () => (await tgApi(w.token, "GET", "/api/kpi/tg/ev/employees?period=2025-10-01")).body.items.map((x: { id: string }) => x.id);
      const both = await ids();
      expect(both).toEqual(expect.arrayContaining([w.cleaner.id, cleanerB.id]));
      expect(both).not.toContain(twin.id);
      await db.update(employee_twins).set({ blocked: true });
      const one = await ids();
      expect(one).toContain(w.cleaner.id);
      expect(one).not.toContain(cleanerB.id);
    });

    it("менеджер с учётной записью: права пользователя и менеджера складываются", async () => {
      const w = await branch();
      const ev = await makeEvaluator(db);
      const otherT = await makeTerminal(db);
      await makeScope(db, ev.id, { terminal_id: otherT.id });
      const cookOther = await makeEmployee(db, { role_code: "cook", terminal_id: otherT.id });
      await bindTelegram(db, { user_id: ev.id, telegram_id: w.b.telegram_id });
      const login = await tgLogin(w.b.telegram_id);
      expect(login.status).toBe(200);
      const r = await tgApi(login.body.token, "GET", "/api/kpi/tg/ev/employees?period=2025-10-01");
      const ids = r.body.items.map((x: { id: string }) => x.id);
      // Назначение пользователя даёт любую карту своего филиала, менеджерское — только «Технички».
      expect(ids).toEqual(expect.arrayContaining([w.cleaner.id, cookOther.id]));
      expect(ids).not.toContain(w.cook.id);
      expect(ids).not.toContain(w.mgr.id);
    });

    it("пользователь-оценщик без менеджерской роли ведёт себя как раньше (без самоисключения и без чужих филиалов)", async () => {
      const t = await makeTerminal(db);
      const ev = await makeEvaluator(db);
      await makeScope(db, ev.id, { terminal_id: t.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const token = await evSession(db, ev.id);
      const r = await tgApi(token, "GET", "/api/kpi/tg/ev/employees?period=2025-10-01");
      expect(r.body.items.map((x: { id: string }) => x.id)).toContain(e.id);
    });

    it("админка: список менеджеров «автоматически» только для kpi.manage; HR видит филиал и признак Telegram", async () => {
      const w = await branch();
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await api(hr, "GET", "/api/kpi/evaluators/auto");
      expect(r.status).toBe(200);
      const row = (r.body as { employee_id: string; telegram: boolean; terminal_id: string }[]).find((x) => x.employee_id === w.mgr.id)!;
      expect(row).toMatchObject({ telegram: true, terminal_id: w.t.id });
      expect(JSON.stringify(r.body)).not.toContain(w.cook.id);
      const nobody = await withSession({ permissions: ["kpi.view"] });
      expect((await api(nobody, "GET", "/api/kpi/evaluators/auto")).status).toBe(403);
    });
  });
}
