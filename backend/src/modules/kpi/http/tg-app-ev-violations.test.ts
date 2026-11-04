import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в tg-app-auth.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app оценщик: нарушения (пропущено: запускайте через bun run test:http:kpi)", () => {
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
    tgForm,
    tgLogin,
    tgRaw,
    TG_TEST_BOT_TOKEN,
  } = await import("./fixtures");
  const { kpi_notifications, kpi_violations } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { seedDispute, seedViolation, TINY_PNG } = await import("../tg-app/dev-data");
  const { eq } = await import("drizzle-orm");

  describe("kpi: оценщик в мини-приложении, нарушения", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;
    let cookItems: string[];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string; items: { id: string }[] }[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id); // уже по sort
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

    const png = (name = "p.png") => new File([Uint8Array.from(TINY_PNG)], name, { type: "image/png" });
    const mp = (fields: Record<string, string>, files: File[] = []) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      for (const f of files) fd.append("photos", f);
      return fd;
    };
    const OUT = { status: 403, body: { error: "out_of_scope" } };

    it("форма нарушения и запись с фото: ответ, запись, уведомление; фото отдаётся в пределах назначения", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const ev2 = await makeEvaluator(db); await makeScope(db, ev2.id, { terminal_id: t2.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const token = await evSession(db, ev.id);
      const vf = await tgApi(token, "GET", `/api/kpi/tg/ev/violation-form?employee_id=${e.id}`);
      expect(vf.body).toMatchObject({ employee: { id: e.id }, card_title: "Повар (Chopar и Les Ailes)", photo_required: false, max_photos: 3, max_photo_bytes: 10485760, comment_min: 3 });
      expect(vf.body.items).toHaveLength(cookItems.length);
      expect(vf.body.items[0].id).toBe(cookItems[0]);
      expect(await tgApi(token, "GET", `/api/kpi/tg/ev/violation-form?employee_id=${foreign.id}`)).toEqual(OUT);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/violation-form")).status).toBe(404);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/violation-form?employee_id=x")).status).toBe(404);
      expect((await tgApi(token, "GET", `/api/kpi/tg/ev/violation-form?employee_id=${randomUUID()}`)).status).toBe(404);
      const ok = await tgForm(token, "/api/kpi/tg/ev/violations", mp({ employee_id: e.id, card_item_id: cookItems[1], comment: "Грязный пол у кассы" }, [png()]));
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ employee_id: e.id, card_item_id: cookItems[1], comment: "Грязный пол у кассы", status: "active", period: "2025-10-01", open_dispute: false, can_cancel: true });
      expect(ok.body.photo_ids).toHaveLength(1);
      expect(JSON.stringify(ok.body)).not.toContain(ev.id);
      const [n] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `violation_recorded:${ok.body.id}`));
      expect([n.recipient_kind, n.employee_id]).toEqual(["employee", e.id]);
      const file = await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${ok.body.photo_ids[0]}/file`);
      expect([file.status, file.headers.get("content-type")]).toEqual([200, "image/png"]);
      expect([file.headers.get("x-content-type-options"), file.headers.get("cache-control")]).toEqual(["nosniff", "private, max-age=3600"]);
      // Тип расширяем до Uint8Array<ArrayBufferLike>, как у TINY_PNG, иначе tsc не сводит перегрузки toEqual.
      expect(new Uint8Array(await file.arrayBuffer()) as Uint8Array).toEqual(TINY_PNG);
      const theirs = await seedViolation(db, { employee_id: foreign.id, terminal_id: t2.id, recorded_by: ev2.id, period: "2025-10-01", occurred_at: "2025-10-14T07:00:00.000Z", photo: TINY_PNG });
      expect((await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${theirs.photo_id}/file`)).status).toBe(404);
      expect((await tgRaw(token, `/api/kpi/tg/ev/violation-photos/${randomUUID()}/file`)).status).toBe(404);
      expect((await tgRaw(null, `/api/kpi/tg/ev/violation-photos/${ok.body.photo_ids[0]}/file`)).status).toBe(401);
    });

    it("ошибки записи: комментарий, тип и число фото, чужой сотрудник, нет сотрудника, фото обязательно", async () => {
      const t1 = await makeTerminal(db), t2 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const foreign = await makeEmployee(db, { role_code: "cook", terminal_id: t2.id });
      const token = await evSession(db, ev.id);
      const post = (fields: Record<string, string>, files: File[] = []) => tgForm(token, "/api/kpi/tg/ev/violations", mp(fields, files));
      expect((await post({ employee_id: e.id, comment: "ab" })).body).toEqual({ error: "comment_required" });
      expect((await post({ employee_id: e.id, comment: "Нет формы" }, [new File(["x"], "a.txt", { type: "text/plain" })])).body).toEqual({ error: "bad_photo_type" });
      expect((await post({ employee_id: e.id, comment: "Нет формы" }, [png(), png(), png(), png()])).body).toEqual({ error: "too_many_photos" });
      expect(await post({ employee_id: foreign.id, comment: "Нет формы" })).toEqual(OUT);
      expect((await post({ comment: "Нет формы" })).body).toEqual({ error: "bad_id" });
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: true })).status).toBe(200);
      expect((await post({ employee_id: e.id, comment: "Нет формы" })).body).toEqual({ error: "photo_required" });
      expect((await api(hr, "PUT", "/api/kpi/settings", { violation_photo_required: false })).status).toBe(200);
      const emp = await makeEmployee(db, { role_code: "cook" });
      const empToken = (await tgLogin((await bindTelegram(db, { employee_id: emp.id })).telegram_id)).body.token;
      expect(await tgForm(empToken, "/api/kpi/tg/ev/violations", mp({ employee_id: e.id, comment: "Нет формы" }))).toEqual({ status: 403, body: { error: "not_evaluator" } });
    });

    it("нарушение пишется текущим временем: occurred_at из запроса игнорируется", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const token = await evSession(db, ev.id);
      const r = await tgForm(token, "/api/kpi/tg/ev/violations", mp({ employee_id: e.id, comment: "Опоздал на смену", occurred_at: "2025-09-15T10:00:00+05:00" }));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ occurred_at: "2025-10-26T05:00:00.000Z", period: "2025-10-01", photo_ids: [] });
    });

    it("мои нарушения и отмена: только мои, can_cancel, чужое и спор не отменяются, роль с approve тоже", async () => {
      setNow("2025-10-26T10:00:00+05:00");
      const t1 = await makeTerminal(db);
      const ev = await makeEvaluator(db); await makeScope(db, ev.id, { terminal_id: t1.id });
      const other = await makeEvaluator(db); await makeScope(db, other.id, { terminal_id: t1.id });
      const hr = await makeEvaluator(db, { perms: ["kpi.evaluate", "kpi.approve"] }); await makeScope(db, hr.id, { terminal_id: t1.id });
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: t1.id });
      const v = (o: object) => seedViolation(db, { employee_id: e.id, terminal_id: t1.id, recorded_by: ev.id, period: "2025-10-01", occurred_at: "2025-10-20T07:00:00.000Z", ...o } as any);
      const mine = await v({ comment: "Мой", photo: TINY_PNG });
      const gone = await v({ status: "cancelled", cancel_reason: "ошибка" });
      const disputed = await v({});
      await seedDispute(db, { subject_type: "violation", subject_id: disputed.id, employee_id: e.id, period: "2025-10-01" });
      const others = await v({ recorded_by: other.id });
      const token = await evSession(db, ev.id);
      const list = await tgApi(token, "GET", "/api/kpi/tg/ev/violations?period=2025-10-01");
      expect(list.body).toMatchObject({ period: "2025-10-01", period_status: "open" });
      const byId = new Map<string, any>(list.body.items.map((x: any) => [x.id, x]));
      expect([...byId.keys()].sort()).toEqual([mine.id, gone.id, disputed.id].sort());
      expect([byId.get(mine.id).can_cancel, byId.get(gone.id).can_cancel, byId.get(disputed.id).can_cancel]).toEqual([true, false, false]);
      expect(byId.get(mine.id).photo_ids).toEqual([mine.photo_id]);
      expect((await tgApi(token, "GET", "/api/kpi/tg/ev/violations")).body.period).toBe("2025-10-01");
      const cancel = (id: string, reason: unknown, tk = token) => tgApi(tk, "POST", `/api/kpi/tg/ev/violations/${id}/cancel`, { reason });
      expect(await cancel(mine.id, "ab")).toEqual({ status: 422, body: { error: "comment_required" } });
      const c = await cancel(mine.id, "Записано по ошибке");
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ id: mine.id, status: "cancelled", cancel_reason: "Записано по ошибке", can_cancel: false });
      expect((await cancel(mine.id, "Записано по ошибке")).body).toEqual({ error: "already_cancelled" });
      expect(await cancel(disputed.id, "Записано по ошибке")).toEqual({ status: 409, body: { error: "open_dispute" } });
      expect(await cancel(others.id, "Записано по ошибке")).toEqual({ status: 403, body: { error: "forbidden" } });
      expect(await cancel(others.id, "Записано по ошибке", await evSession(db, hr.id))).toEqual({ status: 403, body: { error: "forbidden" } });
      const [row] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, others.id));
      expect(row.status).toBe("active");
      expect((await cancel(randomUUID(), "Записано по ошибке")).status).toBe(404);
    });
  });
}
