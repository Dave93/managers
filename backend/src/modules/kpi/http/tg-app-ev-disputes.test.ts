import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: споры (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const {
    api,
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
    TG_TEST_BOT_TOKEN,
  } = await import("./fixtures");
  const { kpi_disputes, kpi_notifications, kpi_periods, kpi_review_events, kpi_reviews, kpi_violations } = await import(
    "backend/drizzle/schema"
  );
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedDispute, seedReview, seedViolation } = await import("../tg-app/dev-data");
  const { eq } = await import("drizzle-orm");

  describe("kpi: оценщик в мини-приложении, споры", () => {
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

    const setupDispute = async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const rv = await seedReview(db, { employee_id: e.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01",
        scores: cookItems.map((_, i) => (i === 1 ? 50 : 100)) });
      const d = await seedDispute(db, { subject_type: "review", subject_id: rv.id, employee_id: e.id, period: "2025-10-01" });
      return { t1, ev, e, rv, d, token: await evSession(db, ev.id) };
    };
    const resolve = (token: string, id: string, body: object) => tgApi(token, "POST", `/api/kpi/tg/ev/disputes/${id}/resolve`, body);

    it("список и карточка: мой спор с разбором; спор вне назначения не виден; HR-роль без kpi.evaluate — 403", async () => {
      const { e, rv, d, token } = await setupDispute();
      const list = await tgApi(token, "GET", "/api/kpi/tg/ev/disputes");
      const mine = list.body.items.find((x: any) => x.id === d.id);
      expect(mine).toMatchObject({ status: "open", can_resolve: true, employee_id: e.id, period: "2025-10-01", subject_type: "review", reason: "Тест спор: не согласен", subject: { kind: "review", score_pct: rv.score_pct } });
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/disputes?status=rejected")).body.items.map((x: any) => x.id)).not.toContain(d.id);
      expect(await tgApi(token, "GET", "/api/kpi/tg/ev/disputes?status=bad")).toEqual({ status: 422, body: { error: "bad_status" } });
      const detail = await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d.id}`);
      expect(detail.body).toMatchObject({ comment_min: 5, dispute: { id: d.id, can_resolve: true }, form: { review: { status: "submitted" }, can_edit: false } });
      expect(detail.body.form.items).toHaveLength(cookItems.length);
      const t2 = await makeTerminal(db);
      const ev3 = await makeEvaluator(db); await makeScope(db, ev3.id, { terminal_id: t2.id });
      const token3 = await evSession(db, ev3.id);
      expect((await tgApi(token3, "GET", "/api/kpi/tg/ev/disputes")).body.items.map((x: any) => x.id)).not.toContain(d.id);
      expect(await tgApi(token3, "GET", `/api/kpi/tg/ev/disputes/${d.id}`)).toEqual({ status: 404, body: { error: "not_found" } });
      expect((await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${randomUUID()}`)).status).toBe(404);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/disputes/x")).status).toBe(404);
      const hr = await makeEvaluator(db, { perms: ["kpi.approve"] });
      expect(await tgApi(await evSession(db, hr.id), "GET", "/api/kpi/tg/ev/disputes")).toEqual({ status: 403, body: { error: "forbidden" } });
    });

    it("разбор: принять оценку с новыми баллами; отклонить; принять спор по нарушению отменяет его", async () => {
      const { t1, ev, e, rv, d, token } = await setupDispute();
      const detail = (await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d.id}`)).body;
      const items = detail.form.items.map((i: any) => ({ item_id: i.item_id, score: i.item_id === cookItems[1] ? 100 : i.score, note: i.note }));
      const ok = await resolve(token, d.id, { decision: "accepted", comment: "Согласен, пересчитал", items });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: d.id, status: "accepted", resolution_comment: "Согласен, пересчитал", can_resolve: false });
      const [row] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, rv.id));
      expect(Number(row.score_pct)).toBe(100);
      const kinds = (await db.select().from(kpi_review_events).where(eq(kpi_review_events.review_id, rv.id))).map((x) => x.kind);
      expect(kinds).toEqual(expect.arrayContaining(["changed", "dispute_resolved"]));
      const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `dispute_resolved:${d.id}`));
      expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
      expect((await resolve(token, d.id, { decision: "rejected", comment: "Оценка верна" })).body).toEqual({ error: "dispute_closed" });

      const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const rv2 = await seedReview(db, { employee_id: e2.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-10-01", scores: cookItems.map(() => 90) });
      const d2 = await seedDispute(db, { subject_type: "review", subject_id: rv2.id, employee_id: e2.id, period: "2025-10-01" });
      const rej = await resolve(token, d2.id, { decision: "rejected", comment: "Оценка верна" });
      expect([rej.status, rej.body.status]).toEqual([200, "rejected"]);
      expect(Number((await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, rv2.id)))[0].score_pct)).toBe(90);

      const e3 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const vio = await seedViolation(db, { employee_id: e3.id, terminal_id: t1.id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-20T07:00:00.000Z" });
      const d3 = await seedDispute(db, { subject_type: "violation", subject_id: vio.id, employee_id: e3.id, period: "2025-10-01" });
      const listed = (await tgApi(token, "GET", "/api/kpi/tg/ev/disputes")).body.items.find((x: any) => x.id === d3.id);
      expect(listed.subject).toMatchObject({ kind: "violation", comment: "Тест нарушение", photo_ids: [] });
      expect((await resolve(token, d3.id, { decision: "accepted", comment: "Нарушение снято" })).body.status).toBe("accepted");
      expect((await db.select().from(kpi_violations).where(eq(kpi_violations.id, vio.id)))[0].status).toBe("cancelled");
    });

    it("ошибки разбора: нет баллов, коротко, неверное решение, чужой спор, закрытый месяц", async () => {
      const { t1, ev, d, token } = await setupDispute();
      expect(await resolve(token, d.id, { decision: "accepted", comment: "Согласен, пересчитал" })).toEqual({ status: 422, body: { error: "items_required" } });
      expect(await resolve(token, d.id, { decision: "rejected", comment: "ab" })).toEqual({ status: 422, body: { error: "comment_required", min: 5 } });
      expect(await resolve(token, d.id, { decision: "maybe", comment: "Оценка верна" })).toEqual({ status: 422, body: { error: "bad_decision" } });
      const t2 = await makeTerminal(db);
      const ev3 = await makeEvaluator(db); await makeScope(db, ev3.id, { terminal_id: t2.id });
      expect(await resolve(await evSession(db, ev3.id), d.id, { decision: "rejected", comment: "Оценка верна" })).toEqual({ status: 403, body: { error: "out_of_scope" } });
      const hr = await makeEvaluator(db, { perms: ["kpi.approve"] });
      expect(await resolve(await evSession(db, hr.id), d.id, { decision: "rejected", comment: "Оценка верна" })).toEqual({ status: 403, body: { error: "forbidden" } });
      expect((await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, d.id)))[0].status).toBe("open");
      const e4 = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const old = await seedReview(db, { employee_id: e4.id, terminal_id: t1.id, card_id: cookCardId, evaluator_user_id: ev.id, period: "2025-09-01", scores: cookItems.map(() => 80) });
      const d4 = await seedDispute(db, { subject_type: "review", subject_id: old.id, employee_id: e4.id, period: "2025-09-01" });
      await db.insert(kpi_periods).values({ period: "2025-09-01", status: "closed" });
      const form = (await tgApi(token, "GET", `/api/kpi/tg/ev/disputes/${d4.id}`)).body.form;
      const items = form.items.map((i: any) => ({ item_id: i.item_id, score: 100, note: i.note }));
      expect(await resolve(token, d4.id, { decision: "accepted", comment: "Согласен, пересчитал", items })).toEqual({ status: 409, body: { error: "period_closed" } });
    });
  });
}
