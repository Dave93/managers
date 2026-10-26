import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app review (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeUser, setNow, setup, tgApi, tgLogin, tgRaw, TG_TEST_BOT_TOKEN } =
    await import("./fixtures");
  const { kpi_disputes, kpi_notifications, kpi_review_events } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedDispute, seedReview, seedViolation, TINY_PNG } = await import("../tg-app/dev-data");
  const { iso } = await import("../iso");
  const { and, eq } = await import("drizzle-orm");

  const login = async (b: { telegram_id: number }) => (await tgLogin(b.telegram_id)).body.token as string;

  describe("kpi: разбор оценки, нарушения, фото и спор в мини-приложении", () => {
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
      // Шкала явно и убывающей: ответ «Вся оценка» обязан отдать её по возрастанию.
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

    it("вся оценка: группы, источник, заметки, нет данных, изменения; черновик и чужое — 404", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "senior_cook" });
      const r = await seedReview(db, { ...base(e, seniorCardId), period: "2025-10-01",
        scores: [null, 100, 75, 100, 90, 100, 100, 80, 100], notes: [null, null, "Форма была грязной 14 и 18 октября"],
        change: { old_score_pct: 85, comment: "Пересчитали гигиену" } });
      await seedReview(db, { ...base(e, seniorCardId), period: "2025-09-01", scores: [100, 100, 100, 100, 100, 100, 100, 100, 100], status: "draft" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const v = (await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-10-01")).body;
      expect([v.review_id, v.status, v.reason_min, v.dispute.state]).toEqual([r.id, "changed", 5, "can"]);
      // Шкала для защиты порога в заголовке (решение 6 плана 7): по возрастанию min_pct.
      expect(v.tiers).toEqual([{ min_pct: 85, amount: 150000 }, { min_pct: 90, amount: 300000 }, { min_pct: 95, amount: 500000 }]);
      expect(v.items.map((i: any) => i.group_key)).toEqual(["base", "base", "base", "base", "base", "base", "base", "extra", "extra"]);
      expect(v.items[0]).toMatchObject({ title_ru: "Приход и уход", source: "attendance", score: null });
      expect(v.items[2]).toMatchObject({ score: 75, note: "Форма была грязной 14 и 18 октября" });
      expect(v.changes).toEqual([{ at: expect.any(String), old_score_pct: 85, new_score_pct: r.score_pct, comment: "Пересчитали гигиену" }]);
      expect(JSON.stringify(v)).not.toContain(ev.id);
      // Черновик неотличим от «нет оценки»: тело наше, а не 404 Elysia на незнакомый путь.
      expect(await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-09-01")).toEqual({ status: 404, body: { error: "not_found" } });
      expect((await tgApi(token, "GET", "/api/kpi/tg/review?period=2025-10")).body).toEqual({ error: "bad_period" });
      expect(await tgApi(token, "GET", "/api/kpi/tg/review")).toEqual({ status: 422, body: { error: "bad_period" } });
      const other = await makeEmployee(db, { role_code: "cook" });
      const t2 = await login(await bindTelegram(db, { employee_id: other.id }));
      expect(await tgApi(t2, "GET", "/api/kpi/tg/review?period=2025-10-01")).toEqual({ status: 404, body: { error: "not_found" } });
    });

    it("нарушения: только свои, новые сверху, отменённое с причиной, открытый спор, фото", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const v = (o: object) => seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", ...o } as any);
      const a = await v({ occurred_at: "2025-10-14T14:40:00.000Z", card_item_id: cookItems[2], comment: "Грязный пол у кассы", photo: TINY_PNG });
      const b = await v({ occurred_at: "2025-10-09T07:00:00.000Z", status: "cancelled", cancel_reason: "записано по ошибке" });
      const c = await v({ occurred_at: "2025-10-20T07:00:00.000Z" });
      await seedDispute(db, { subject_type: "violation", subject_id: c.id, employee_id: e.id, period: "2025-10-01" });
      const stranger = await makeEmployee(db, { role_code: "cook" });
      await seedViolation(db, { employee_id: stranger.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-21T07:00:00.000Z" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const body = (await tgApi(token, "GET", "/api/kpi/tg/violations?period=2025-10-01")).body;
      expect(body.items.map((x: any) => [x.id, x.status, x.dispute.state])).toEqual([[c.id, "active", "open"], [a.id, "active", "can"], [b.id, "cancelled", "cancelled"]]);
      expect(body.items[1]).toMatchObject({ item_title_ru: "Гигиена сотрудника", item_title_uz: "Xodim gigiyenasi", photo_ids: [a.photo_id] });
      expect(body.items[2].cancel_reason).toBe("записано по ошибке");
      expect(JSON.stringify(body)).not.toContain(ev.id);
      expect((await tgApi(token, "GET", "/api/kpi/tg/violations?period=2025-10")).body).toEqual({ error: "bad_period" });
    });

    it("фото: своё — файл; чужое, случайное, кривое — 404; оценщику — 403", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const mine = await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
      const s = await makeEmployee(db, { role_code: "cook" });
      const theirs = await seedViolation(db, { employee_id: s.id, terminal_id: s.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const ok = await tgRaw(token, `/api/kpi/tg/violation-photos/${mine.photo_id}/file`);
      expect([ok.status, ok.headers.get("content-type")]).toEqual([200, "image/png"]);
      // Тип расширяем до Uint8Array<ArrayBufferLike>, как у TINY_PNG, иначе tsc не сводит перегрузки toEqual.
      expect(new Uint8Array(await ok.arrayBuffer()) as Uint8Array).toEqual(TINY_PNG);
      for (const id of [theirs.photo_id, randomUUID(), "x"]) expect((await tgRaw(token, `/api/kpi/tg/violation-photos/${id}/file`)).status).toBe(404);
      const u = await makeUser(db);
      const evToken = await login(await bindTelegram(db, { user_id: u.id }));
      expect((await tgApi(evToken, "GET", `/api/kpi/tg/violation-photos/${mine.photo_id}/file`)).body).toEqual({ error: "not_employee" });
      expect((await tgRaw(null, `/api/kpi/tg/violation-photos/${mine.photo_id}/file`)).status).toBe(401);
    });

    it("спор из приложения: opened_via miniapp, событие, уведомление оценщику; повтор — 409; главный экран — «на рассмотрении»", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const r = await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 75, 100, 100, 100, 100] });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const body = { subject_type: "review", subject_id: r.id, reason: "18 октября у меня был выходной" };
      const res = await tgApi(token, "POST", "/api/kpi/tg/disputes", body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: expect.any(String), subject_type: "review", subject_id: r.id, created_at: expect.any(String) });
      const [d] = await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, res.body.id));
      expect([d.opened_via, d.opened_by_user_id, d.employee_id, d.status]).toEqual(["miniapp", null, e.id, "open"]);
      const [evt] = await db.select().from(kpi_review_events).where(and(eq(kpi_review_events.review_id, r.id), eq(kpi_review_events.kind, "dispute_opened")));
      expect(evt.actor_kind).toBe("employee");
      const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `dispute_opened:${d.id}`));
      expect([n.recipient_kind, n.user_id]).toEqual(["user", ev.id]);
      expect((await tgApi(token, "POST", "/api/kpi/tg/disputes", body)).body).toEqual({ error: "dispute_exists" });
      const home = (await tgApi(token, "GET", "/api/kpi/tg/home")).body.employee.month;
      expect([home.status, home.dispute.state, home.dispute.opened_at]).toEqual(["dispute_open", "open", iso(d.created_at)]);
    });

    it("спор: чужая запись и черновик — 404 без строки; коротко — 422; отменённое — 409; кривой тип — 422; после срока — 409", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const s = await makeEmployee(db, { role_code: "cook" });
      const theirs = await seedReview(db, { ...base(s), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const theirsV = await seedViolation(db, { employee_id: s.id, terminal_id: s.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z" });
      const draft = await seedReview(db, { ...base(e), period: "2025-09-01", scores: [100, 100, 100, 100, 100, 100, 100], status: "draft" });
      const mine = await seedReview(db, { ...base(e), period: "2025-10-01", scores: [100, 100, 100, 100, 100, 100, 100] });
      const gone = await seedViolation(db, { employee_id: e.id, terminal_id: e.terminal_id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", status: "cancelled", cancel_reason: "ошибка" });
      const token = await login(await bindTelegram(db, { employee_id: e.id }));
      const post = (b: object) => tgApi(token, "POST", "/api/kpi/tg/disputes", { reason: "Не согласен с оценкой", ...b });
      const before = (await db.select().from(kpi_disputes)).length;
      const notFound = { status: 404, body: { error: "not_found" } };
      // Подставленный id чужой оценки или чужого нарушения: openDispute с employee_actor владельца не проверяет.
      expect(await post({ subject_type: "review", subject_id: theirs.id })).toEqual(notFound);
      expect(await post({ subject_type: "violation", subject_id: theirsV.id })).toEqual(notFound);
      // id оценки под видом нарушения и наоборот — тоже «нет такого».
      expect(await post({ subject_type: "violation", subject_id: mine.id })).toEqual(notFound);
      expect(await post({ subject_type: "review", subject_id: gone.id })).toEqual(notFound);
      // Черновик — 404, а не 409 not_submitted (решение 14).
      expect(await post({ subject_type: "review", subject_id: draft.id })).toEqual(notFound);
      expect(await post({ subject_type: "review", subject_id: "x" })).toEqual(notFound);
      expect(await post({ subject_type: "review", subject_id: randomUUID() })).toEqual(notFound);
      expect((await db.select().from(kpi_disputes)).length).toBe(before);
      expect(await post({ subject_type: "review", subject_id: mine.id, reason: "ок" })).toEqual({ status: 422, body: { error: "comment_required", min: 5 } });
      expect(await post({ subject_type: "review", subject_id: mine.id, reason: 12345 })).toEqual({ status: 422, body: { error: "comment_required", min: 5 } });
      expect((await post({ subject_type: "violation", subject_id: gone.id })).body).toEqual({ error: "already_cancelled" });
      expect((await post({ subject_type: "branch_result", subject_id: mine.id })).body).toEqual({ error: "bad_subject_type" });
      setNow("2025-11-11T10:00:00+05:00");
      expect((await post({ subject_type: "review", subject_id: mine.id })).body).toEqual({ error: "dispute_window_closed" });
      expect((await db.select().from(kpi_disputes)).length).toBe(before);
    });
  });
}
