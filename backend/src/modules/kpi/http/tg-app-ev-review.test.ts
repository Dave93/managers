import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: форма, черновик, отправка (пропущено: запускайте через bun run test:http:kpi)", () => {
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
  const { kpi_employee_cards, kpi_evaluator_scopes, kpi_notifications, kpi_periods, kpi_reviews, kpi_tg_bindings } = await import(
    "backend/drizzle/schema"
  );
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedReview } = await import("../tg-app/dev-data");
  const { eq } = await import("drizzle-orm");

  describe("kpi: оценщик в мини-приложении, форма оценки, черновик, отправка", () => {
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
    const formOf = (token: string, e: { id: string }, period = "2025-10-01") =>
      tgApi(token, "GET", `/api/kpi/tg/ev/form?period=${period}&employee_id=${e.id}`);
    const fill = (form: any, v = 100) => form.items.map((i: any) => ({ item_id: i.item_id, score: i.source === "manual" ? v : null }));
    const put = (token: string, body: object) => tgApi(token, "PUT", "/api/kpi/tg/ev/draft", { period: "2025-10-01", ...body });
    const submit = (token: string, id: string) => tgApi(token, "POST", `/api/kpi/tg/ev/reviews/${id}/submit`, {});

    it("форма, черновик и отправка: те же проверки и результат, что в админке; уведомление сотруднику", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      const f0 = await formOf(token, e);
      expect(f0.status).toBe(200);
      expect(f0.body).toMatchObject({ period: "2025-10-01", period_status: "open", review: null, can_edit: true, open_dispute: false, dispute_rejected: false, submit_opens_at: "2025-10-19T19:00:00.000Z" });
      expect(f0.body.items).toHaveLength(cookItems.length);
      expect(JSON.stringify(f0.body)).not.toContain(ev.id);
      const d = await put(token, { employee_id: e.id, items: fill(f0.body) });
      expect(d.status).toBe(200);
      expect(d.body.review).toMatchObject({ status: "draft" });
      const [row] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, d.body.review.id));
      expect(row.evaluator_user_id).toBe(ev.id);
      const s = await submit(token, d.body.review.id);
      expect(s.status).toBe(200);
      expect(s.body.review).toMatchObject({ status: "submitted" });
      expect(s.body.can_edit).toBe(false);
      const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${d.body.review.id}`));
      expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
      expect(await submit(token, d.body.review.id)).toEqual({ status: 409, body: { error: "already_submitted" } });
      expect(await put(token, { employee_id: e.id, items: [] })).toEqual({ status: 409, body: { error: "already_submitted" } });
      const admin = await withSession({ permissions: ["kpi.evaluate"], userId: ev.id });
      const af = await api(admin, "GET", `/api/kpi/reviews/form?period=2025-10-01&employee_id=${e.id}`);
      expect(af.body.review.score_pct).toBe(s.body.review.score_pct);
    });

    it("ошибки сервисов доходят как есть: too_early, missing_items, bad_score, unknown_item, period_closed, no_card", async () => {
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      setNow("2025-10-19T10:00:00+05:00");
      const e1 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const d1 = await put(token, { employee_id: e1.id, items: fill((await formOf(token, e1)).body) });
      expect(await submit(token, d1.body.review.id)).toEqual({ status: 409, body: { error: "too_early", opens_at: "2025-10-19T19:00:00.000Z" } });
      setNow("2025-10-26T10:00:00+05:00");
      const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const f2 = (await formOf(token, e2)).body;
      const d2 = await put(token, { employee_id: e2.id, items: [] });
      const miss = await submit(token, d2.body.review.id);
      expect([miss.status, miss.body.error]).toEqual([422, "missing_items"]);
      expect(miss.body.items.slice().sort()).toEqual(f2.items.filter((i: any) => i.source === "manual").map((i: any) => i.item_id).sort());
      expect(await put(token, { employee_id: e2.id, items: [{ item_id: cookItems[1], score: 101 }] })).toEqual({ status: 422, body: { error: "bad_score", item_id: cookItems[1] } });
      const ghost = randomUUID();
      expect(await put(token, { employee_id: e2.id, items: [{ item_id: ghost, score: 50 }] })).toEqual({ status: 422, body: { error: "unknown_item", item_id: ghost } });
      await db.insert(kpi_periods).values({ period: "2025-08-01", status: "closed" });
      expect(await put(token, { period: "2025-08-01", employee_id: e2.id, items: [] })).toEqual({ status: 409, body: { error: "period_closed" } });
      expect((await formOf(token, e2, "2025-08-01")).body).toMatchObject({ period_status: "closed", can_edit: false });
      await db.insert(kpi_employee_cards).values({ employee_id: e2.id, card_id: null });
      // Сотрудника сняли с оценки (карта null) после загрузки формы: назначение «все карты» его ещё покрывает, но оценивать нечем.
      expect(await formOf(token, e2, "2025-09-01")).toEqual({ status: 422, body: { error: "no_card" } });
      expect(await put(token, { period: "2025-09-01", employee_id: e2.id, items: [] })).toEqual({ status: 422, body: { error: "no_card" } });
    });

    it("вне назначения: форма, черновик и отправка по id чужой оценки — 403; несуществующее и кривое — 404; мусор — 422", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const ev2 = await makeEvaluator(db); await makeScope(db, ev2.id, { terminal_id: t2.id });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const fr = await seedReview(db, { ...base(ev2, foreign), scores: cookItems.map(() => 100), status: "draft" });
      const token = await evSession(db, ev.id);
      const OUT = { status: 403, body: { error: "out_of_scope" } };
      expect(await formOf(token, foreign)).toEqual(OUT);
      expect(await put(token, { employee_id: foreign.id, items: [] })).toEqual(OUT);
      expect(await submit(token, fr.id)).toEqual(OUT);
      expect((await formOf(token, { id: randomUUID() })).status).toBe(404);
      expect((await formOf(token, { id: "x" })).status).toBe(404);
      expect((await submit(token, randomUUID())).status).toBe(404);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/form?period=2025-10-01")).toEqual({ status: 422, body: { error: "bad_id" } });
      expect(await tgApi(token, "GET", `/api/kpi/tg/ev/form?period=oct&employee_id=${foreign.id}`)).toEqual({ status: 422, body: { error: "bad_period" } });
      const [still] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, fr.id));
      expect(still.status).toBe("draft");
    });

    it("роль с kpi.approve не открывает форму чужого филиала; снятое назначение и отвязка действуют сразу", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const mine = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve", "kpi.view"] });
      await makeScope(db, hr.id, { terminal_id: t1.id });
      const b = await bindTelegram(db, { user_id: hr.id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      expect((await formOf(token, mine)).status).toBe(200);
      expect(await formOf(token, foreign)).toEqual({ status: 403, body: { error: "out_of_scope" } });
      await db.delete(kpi_evaluator_scopes).where(eq(kpi_evaluator_scopes.user_id, hr.id));
      expect(await formOf(token, mine)).toEqual({ status: 403, body: { error: "out_of_scope" } });
      await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
      expect((await formOf(token, mine)).status).toBe(401);
    });
  });
}
