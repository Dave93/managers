import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/disputes (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_disputes, kpi_notifications, kpi_periods, kpi_review_events, kpi_violations } = await import(
    "backend/drizzle/schema"
  );
  const { openDispute } = await import("../disputes");
  const { eq } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type DisputeRow = import("../types").DisputeRow;
  type PeriodSummary = import("../types").PeriodSummary;
  type ReviewForm = import("../types").ReviewForm;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-06-01";
  const NOW = "2025-06-25T10:00:00+05:00"; // отправка открыта с 20 июня
  const D_OPEN = "2025-07-09T10:00:00+05:00"; // окно споров ещё открыто
  const D_AFTER_REVIEW = "2025-07-08T12:00:00+05:00"; // срок оценки (7 июля) прошёл, окно споров открыто
  const D_CLOSED = "2025-07-11T10:00:00+05:00"; // окно споров закрылось 10 июля 23:59

  describe("kpi: споры и закрытие месяца", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: string[];

    const evaluator = async (terminal_id: string, perms = ["kpi.evaluate"]) => {
      const s = await withSession({ permissions: perms });
      await makeScope(db, s.userId, { terminal_id });
      return s;
    };
    const cook = (terminal_id?: string) => makeEmployee(db, { role_code: "cook", terminal_id });
    const scores = (vals: (number | null)[]) => vals.map((score, i) => ({ item_id: cookItems[i + 1], score }));
    const FULL = [100, 100, 50, 50, 100, 100];
    const draft = (s: Session, employee_id: string, items: unknown[]) =>
      api(s, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id, items });
    // Отправленная оценка за июнь; возвращает id оценки.
    const submitted = async (s: Session, employee_id: string): Promise<string> => {
      setNow(NOW);
      const d = await draft(s, employee_id, scores(FULL));
      expect(d.status).toBe(200);
      const id = d.body.review.id as string;
      expect((await api(s, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      return id;
    };
    const dispute = (s: Session, subject_type: string, subject_id: string, reason = "Не согласен с оценкой") =>
      api(s, "POST", "/api/kpi/disputes", { subject_type, subject_id, reason });
    const resolve = (s: Session, id: string, body: unknown) => api(s, "POST", `/api/kpi/disputes/${id}/resolve`, body);
    const events = async (s: Session, reviewId: string) =>
      (await api(s, "GET", `/api/kpi/reviews/${reviewId}/events`)).body as { kind: string; comment: string | null; actor_kind: string }[];
    const note = async (key: string) =>
      db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, key));
    const makeViolation = async (s: Session, e: { id: string; terminal_id: string }) => {
      const [v] = await db
        .insert(kpi_violations)
        .values({
          terminal_id: e.terminal_id,
          employee_id: e.id,
          period: P,
          occurred_at: "2025-06-10T10:00:00+05:00",
          comment: "Грязный фартук",
          recorded_by: s.userId,
        })
        .returning();
      return v;
    };
    // Месяц должен быть чистым от чужих споров: закрытие смотрит на все споры периода.
    const resetPeriod = async () => {
      await db.delete(kpi_disputes);
      await db.delete(kpi_periods);
    };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("спор по оценке до 10 июля: 200, событие dispute_opened, уведомление оценщику; второй — 409 dispute_exists", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);

      // Пустая причина из пробелов и чужой филиал отсекаются до записи.
      expect((await dispute(ev, "review", reviewId, "   ")).body.error).toBe("comment_required");
      const stranger = await evaluator(randomUUID());
      const denied = await dispute(stranger, "review", reviewId);
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "out_of_scope" });
      const noPerm = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      expect((await dispute(noPerm, "review", reviewId)).status).toBe(403);

      const r = await dispute(ev, "review", reviewId, "  Не согласен с баллом  ");
      expect(r.status).toBe(200);
      const d = r.body as DisputeRow;
      expect(d.status).toBe("open");
      expect(d.subject_type).toBe("review");
      expect(d.subject_id).toBe(reviewId);
      expect(d.employee_id).toBe(e.id);
      expect(d.employee_name).toContain("Тест Повар");
      expect(d.period).toBe(P);
      expect(d.opened_via).toBe("admin");
      expect(d.reason).toBe("Не согласен с баллом");
      expect(d.can_resolve).toBe(true);

      const ev1 = await events(ev, reviewId);
      expect(ev1.map((x) => x.kind)).toEqual(["submitted", "dispute_opened"]);
      expect(ev1[1].comment).toBe("Не согласен с баллом");
      expect(ev1[1].actor_kind).toBe("user");

      const notes = await note(`dispute_opened:${d.id}`);
      expect(notes).toHaveLength(1);
      expect(notes[0].recipient_kind).toBe("user");
      expect(notes[0].user_id).toBe(ev.userId);
      expect(notes[0].kind).toBe("dispute_opened");

      const again = await dispute(ev, "review", reviewId);
      expect(again.status).toBe(409);
      expect(again.body).toEqual({ error: "dispute_exists" });

      // Флаг в списке сотрудников.
      const list = await api(ev, "GET", `/api/kpi/reviews?period=${P}&terminal_id=${e.terminal_id}`);
      expect(list.body[0].open_dispute).toBe(true);
    });

    it("два одновременных спора по одной оценке: один 200, другой 409 dispute_exists", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const res = await Promise.all([dispute(ev, "review", reviewId), dispute(ev, "review", reviewId)]);
      expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(res.find((x) => x.status === 409)!.body).toEqual({ error: "dispute_exists" });
    });

    it("спор 11 июля по июню — 409 dispute_window_closed", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      setNow(D_CLOSED);
      const r = await dispute(ev, "review", reviewId);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: "dispute_window_closed" });
      // Последний момент окна: 10 июля 23:59 по Ташкенту.
      setNow("2025-07-10T23:59:00+05:00");
      expect((await dispute(ev, "review", reviewId)).status).toBe(200);
    });

    it("спор по черновику — 409 not_submitted, несуществующий объект — 404, кривой тип — 422", async () => {
      await resetPeriod();
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const d = await draft(ev, e.id, scores(FULL));
      const r = await dispute(ev, "review", d.body.review.id);
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: "not_submitted" });
      expect((await dispute(ev, "review", randomUUID())).status).toBe(404);
      expect((await dispute(ev, "review", "x")).status).toBe(404);
      expect((await dispute(ev, "branch_result", randomUUID())).body).toEqual({ error: "bad_subject_type" });
    });

    it("разбор accepted: без items — 422 items_required, без изменений — 422 no_changes, с изменением — оценка, события и уведомления", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const d = (await dispute(ev, "review", reviewId)).body as DisputeRow;

      const noItems = await resolve(ev, d.id, { decision: "accepted", comment: "Пересмотрели оценку" });
      expect(noItems.status).toBe(422);
      expect(noItems.body).toEqual({ error: "items_required" });
      const empty = await resolve(ev, d.id, { decision: "accepted", comment: "Пересмотрели оценку", items: [] });
      expect(empty.body).toEqual({ error: "items_required" });
      // Те же баллы — изменений нет.
      const same = await resolve(ev, d.id, {
        decision: "accepted",
        comment: "Пересмотрели оценку",
        items: [{ item_id: cookItems[3], score: 50 }],
      });
      expect(same.status).toBe(422);
      expect(same.body.error).toBe("no_changes");
      // Всё это откатилось: спор по-прежнему открыт.
      expect(((await api(ev, "GET", `/api/kpi/disputes?status=open&period=${P}`)).body as DisputeRow[]).map((x) => x.id)).toContain(d.id);

      const ok = await resolve(ev, d.id, {
        decision: "accepted",
        comment: "  Пересмотрели оценку  ",
        items: [{ item_id: cookItems[3], score: 100 }],
      });
      expect(ok.status).toBe(200);
      const done = ok.body as DisputeRow;
      expect(done.status).toBe("accepted");
      expect(done.resolution_comment).toBe("Пересмотрели оценку");
      // Тестовые сессии не пользователи из таблицы users, имени нет.
      expect(done.resolved_by_name).toBeNull();
      expect(done.resolved_at).toBeTruthy();
      expect(done.can_resolve).toBe(false);

      const form = (await api(ev, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${e.id}`)).body as ReviewForm;
      expect(form.review!.version).toBe(2);
      expect(form.items.find((i) => i.item_id === cookItems[3])!.score).toBe(100);
      expect(form.review!.score_pct).toBe(91.67);

      const evs = await events(ev, reviewId);
      expect(evs.map((x) => x.kind)).toEqual(["submitted", "dispute_opened", "changed", "dispute_resolved"]);
      expect(evs[2].comment).toBe("Пересмотрели оценку");
      expect(evs[3].comment).toBe("Пересмотрели оценку");

      const notes = await note(`dispute_resolved:${d.id}`);
      expect(notes).toHaveLength(1);
      expect(notes[0].recipient_kind).toBe("employee");
      expect(notes[0].employee_id).toBe(e.id);
      expect(notes[0].payload).toEqual({
        dispute_id: d.id,
        subject_type: "review",
        subject_id: reviewId,
        decision: "accepted",
        comment: "Пересмотрели оценку",
        period: P,
      });

      const closed = await resolve(ev, d.id, { decision: "rejected", comment: "Повторный разбор" });
      expect(closed.status).toBe(409);
      expect(closed.body).toEqual({ error: "dispute_closed" });
    });

    it("разбор rejected без комментария — 422 comment_required; с комментарием — rejected, оценка не тронута", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const d = (await dispute(ev, "review", reviewId)).body as DisputeRow;

      const blank = await resolve(ev, d.id, { decision: "rejected", comment: "   " });
      expect(blank.status).toBe(422);
      expect(blank.body.error).toBe("comment_required");
      expect((await resolve(ev, d.id, { decision: "maybe", comment: "Какой-то ответ" })).body).toEqual({ error: "bad_decision" });

      // Разбирать может оценщик с назначением или kpi.approve, чужой оценщик не может.
      const stranger = await evaluator(randomUUID());
      expect((await resolve(stranger, d.id, { decision: "rejected", comment: "Чужой разбор" })).status).toBe(403);
      expect((await resolve(ev, randomUUID(), { decision: "rejected", comment: "Нет такого" })).status).toBe(404);

      const hr = await withSession({ permissions: ["kpi.approve"] });
      const ok = await resolve(hr, d.id, { decision: "rejected", comment: "Оценка верна" });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("rejected");
      const form = (await api(ev, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${e.id}`)).body as ReviewForm;
      expect(form.review!.version).toBe(1);
      expect((await events(ev, reviewId)).map((x) => x.kind)).toEqual(["submitted", "dispute_opened", "dispute_resolved"]);
      expect((await note(`dispute_resolved:${d.id}`))[0].payload).toMatchObject({ decision: "rejected" });
    });

    it("спор по нарушению: accepted — нарушение cancelled; по отменённому — 409 already_cancelled; rejected — остаётся", async () => {
      await resetPeriod();
      setNow(NOW);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const v = await makeViolation(ev, e);
      const r = await dispute(ev, "violation", v.id, "Нарушения не было");
      expect(r.status).toBe(200);
      const d = r.body as DisputeRow;
      expect(d.subject_type).toBe("violation");
      expect(d.employee_id).toBe(e.id);
      const notes = await note(`dispute_opened:${d.id}`);
      expect(notes).toHaveLength(1);
      expect(notes[0].user_id).toBe(v.recorded_by);

      const ok = await resolve(ev, d.id, { decision: "accepted", comment: "Подтверждаем ошибку" });
      expect(ok.status).toBe(200);
      const [row] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, v.id));
      expect(row.status).toBe("cancelled");
      expect(row.cancel_reason).toBe("Подтверждаем ошибку");
      expect(row.cancelled_by).toBe(ev.userId);
      expect((await dispute(ev, "violation", v.id)).body).toEqual({ error: "already_cancelled" });

      const v2 = await makeViolation(ev, e);
      const d2 = (await dispute(ev, "violation", v2.id, "Не согласен с записью")).body as DisputeRow;
      expect((await resolve(ev, d2.id, { decision: "rejected", comment: "Запись верна" })).status).toBe(200);
      const [row2] = await db.select().from(kpi_violations).where(eq(kpi_violations.id, v2.id));
      expect(row2.status).toBe("active");
    });

    it("от имени сотрудника (Telegram): права не проверяются, opened_by_user_id пуст, событие от employee", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const d = await openDispute(db, null, {
        subject_type: "review",
        subject_id: reviewId,
        reason: "Мне поставили мало",
        via: "telegram",
        employee_actor: true,
      });
      expect(d.opened_via).toBe("telegram");
      expect(d.can_resolve).toBe(false);
      const [row] = await db.select().from(kpi_disputes).where(eq(kpi_disputes.id, d.id));
      expect(row.opened_by_user_id).toBeNull();
      const evs = await db.select().from(kpi_review_events).where(eq(kpi_review_events.review_id, reviewId));
      const opened = evs.find((x) => x.kind === "dispute_opened")!;
      expect(opened.actor_kind).toBe("employee");
      expect(opened.actor_user_id).toBeNull();
      await expect(
        openDispute(db, null, { subject_type: "review", subject_id: reviewId, reason: "Ещё раз", employee_actor: true })
      ).rejects.toMatchObject({ status: 409, code: "dispute_exists" });
    });

    it("список споров: фильтры status и period, видимость и can_resolve", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const d = (await dispute(ev, "review", reviewId)).body as DisputeRow;
      const e2 = await cook();
      const ev2 = await evaluator(e2.terminal_id);
      const d2 = (await dispute(ev2, "review", await submitted(ev2, e2.id))).body as DisputeRow;
      await resolve(ev2, d2.id, { decision: "rejected", comment: "Оценка верна" });

      const own = (await api(ev, "GET", `/api/kpi/disputes?period=${P}`)).body as DisputeRow[];
      expect(own.map((x) => x.id)).toEqual([d.id]);
      expect(own[0].can_resolve).toBe(true);

      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      const seen = (await api(viewer, "GET", "/api/kpi/disputes")).body as DisputeRow[];
      expect(seen.map((x) => x.id)).toEqual([d.id]);
      expect(seen[0].can_resolve).toBe(false);
      const nobody = await withSession({ permissions: ["kpi.view"], terminals: [randomUUID()] });
      expect((await api(nobody, "GET", "/api/kpi/disputes")).body).toEqual([]);

      const hr = await withSession({ permissions: ["kpi.approve"] });
      const all = (await api(hr, "GET", `/api/kpi/disputes?period=${P}`)).body as DisputeRow[];
      expect(all.map((x) => x.id).sort()).toEqual([d.id, d2.id].sort());
      expect(all.find((x) => x.id === d.id)!.can_resolve).toBe(true);
      expect(all.find((x) => x.id === d2.id)!.can_resolve).toBe(false);
      const open = (await api(hr, "GET", "/api/kpi/disputes?status=open")).body as DisputeRow[];
      expect(open.map((x) => x.id)).toEqual([d.id]);
      expect(((await api(hr, "GET", "/api/kpi/disputes?status=rejected")).body as DisputeRow[]).map((x) => x.id)).toEqual([d2.id]);
      expect(((await api(hr, "GET", "/api/kpi/disputes?period=2025-05-01")).body as DisputeRow[])).toEqual([]);
      expect((await api(hr, "GET", "/api/kpi/disputes?period=2025-06-15")).body).toEqual({ error: "bad_period" });
      expect((await api(hr, "GET", "/api/kpi/disputes?status=zzz")).body).toEqual({ error: "bad_status" });
      const plain = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(plain, "GET", "/api/kpi/disputes")).status).toBe(403);
    });

    it("закрытие: 9 июля — dispute_window_open; 11 июля при споре — open_disputes; после разбора — 200; оценщик — 409 period_closed; HR — hr_adjusted", async () => {
      await resetPeriod();
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const d = (await dispute(ev, "review", reviewId)).body as DisputeRow;
      const hr = await withSession({ permissions: ["kpi.approve"] });
      const close = () => api(hr, "POST", `/api/kpi/periods/${P}/close`);

      setNow(D_OPEN);
      const early = await close();
      expect(early.status).toBe(409);
      expect(early.body).toEqual({ error: "dispute_window_open" });
      const s0 = (await api(hr, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary;
      expect(s0.can_close).toBe(false);
      expect(s0.close_blockers).toEqual(["dispute_window_open", "open_disputes"]);

      setNow(D_CLOSED);
      const blocked = await close();
      expect(blocked.status).toBe(409);
      expect(blocked.body).toEqual({ error: "open_disputes", ids: [d.id] });
      expect(((await api(hr, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary).close_blockers).toEqual(["open_disputes"]);
      expect((await api(ev, "POST", `/api/kpi/periods/${P}/close`)).status).toBe(403);

      expect((await resolve(ev, d.id, { decision: "rejected", comment: "Оценка верна" })).status).toBe(200);
      const s1 = (await api(hr, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary;
      expect(s1.can_close).toBe(true);
      expect(s1.close_blockers).toEqual([]);
      const ok = await close();
      expect(ok.status).toBe(200);
      const s2 = ok.body as PeriodSummary;
      expect(s2.status).toBe("closed");
      expect(s2.closed_at).toBeTruthy();
      expect(s2.closed_by_name).toBeNull();
      expect(s2.can_close).toBe(false);
      expect(s2.close_blockers).toEqual(["already_closed"]);
      const [prow] = await db.select().from(kpi_periods).where(eq(kpi_periods.period, P));
      expect(prow.status).toBe("closed");
      expect(prow.closed_by).toBe(hr.userId);

      expect((await close()).body).toEqual({ error: "already_closed" });
      // В закрытом месяце спор не открыть (окно уже закончилось).
      expect((await dispute(ev, "review", reviewId)).status).toBe(409);

      const change = [{ item_id: cookItems[3], score: 100 }];
      const blockedChange = await api(ev, "PUT", `/api/kpi/reviews/${reviewId}`, { items: change, comment: "правка после закрытия" });
      expect(blockedChange.status).toBe(409);
      expect(blockedChange.body.error).toBe("period_closed");
      const adj = await api(hr, "PUT", `/api/kpi/reviews/${reviewId}`, { items: change, comment: "корректировка HR" });
      expect(adj.status).toBe(200);
      const kinds = (await events(hr, reviewId)).map((x) => x.kind);
      expect(kinds[kinds.length - 1]).toBe("hr_adjusted");
    });

    it("открыть заново: без комментария — 422, месяц не закрыт — 409 not_closed, с комментарием — 200 и status open", async () => {
      await resetPeriod();
      const hr = await withSession({ permissions: ["kpi.approve"] });
      setNow(D_CLOSED);
      const reopen = (body?: unknown) => api(hr, "POST", `/api/kpi/periods/${P}/reopen`, body);

      expect((await reopen({ comment: "причина" })).body).toEqual({ error: "not_closed" });
      expect((await api(hr, "POST", `/api/kpi/periods/${P}/close`)).status).toBe(200);
      expect((await reopen()).body).toEqual({ error: "comment_required" });
      const blank = await reopen({ comment: "   " });
      expect(blank.status).toBe(422);
      expect(blank.body).toEqual({ error: "comment_required" });
      const planner = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(planner, "POST", `/api/kpi/periods/${P}/reopen`, { comment: "причина" })).status).toBe(403);

      const ok = await reopen({ comment: "  Нужна правка баллов  " });
      expect(ok.status).toBe(200);
      expect((ok.body as PeriodSummary).status).toBe("open");
      expect((ok.body as PeriodSummary).closed_at).toBeNull();
      const [row] = await db.select().from(kpi_periods).where(eq(kpi_periods.period, P));
      expect(row.status).toBe("open");
      expect(row.reopen_comment).toBe("Нужна правка баллов");
      // Снова можно закрыть.
      expect((await api(hr, "POST", `/api/kpi/periods/${P}/close`)).status).toBe(200);
      expect((await api(hr, "POST", "/api/kpi/periods/2025-06-15/close")).body).toEqual({ error: "bad_period" });
    });

    it("сводка: counts и lagging на 3 сотрудниках (1 отправлена, 1 черновик, 1 без оценки)", async () => {
      await resetPeriod();
      const e1 = await cook();
      const e2 = await cook(e1.terminal_id);
      const e3 = await cook(e1.terminal_id);
      const ev = await evaluator(e1.terminal_id);
      await submitted(ev, e1.id);
      expect((await draft(ev, e2.id, scores(FULL))).status).toBe(200);
      void e3;

      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e1.terminal_id] });
      const v = await api(viewer, "GET", `/api/kpi/periods/${P}`);
      expect(v.status).toBe(200);
      const sv = v.body as PeriodSummary;
      expect(sv.period).toBe(P);
      expect(sv.status).toBe("open");
      expect(sv.counts).toEqual({ employees: 3, submitted: 1, drafts: 1, none: 1, late: 0, open_disputes: 0 });
      expect(sv.lagging).toEqual([]);
      expect(sv.deadlines.dispute_deadline).toBe(new Date("2025-07-10T23:59:59.999+05:00").toISOString());
      expect(sv.deadlines.review_deadline).toBe(new Date("2025-07-07T23:59:59.999+05:00").toISOString());

      const hr = await withSession({ permissions: ["kpi.approve"] });
      const s = (await api(hr, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary;
      const mine = s.lagging.find((x) => x.user_id === ev.userId)!;
      expect(mine.pending).toBe(2);
      expect(mine.user_name).toBeTruthy();
      expect(s.lagging.map((x) => x.pending)).toEqual([...s.lagging.map((x) => x.pending)].sort((a, b) => b - a));
      const manager = await withSession({ permissions: ["kpi.manage"] });
      const sm = (await api(manager, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary;
      expect(sm.lagging.find((x) => x.user_id === ev.userId)!.pending).toBe(2);

      // Открытый спор попадает в счётчик; после срока оценки неотправленные считаются опоздавшими.
      const d = await dispute(ev, "review", (await api(ev, "GET", `/api/kpi/reviews?period=${P}&terminal_id=${e1.terminal_id}&status=submitted`)).body[0].review.id);
      expect(d.status).toBe(200);
      setNow(D_AFTER_REVIEW);
      const late = ((await api(viewer, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary).counts;
      expect(late).toEqual({ employees: 3, submitted: 1, drafts: 1, none: 1, late: 2, open_disputes: 1 });
      const stranger = await withSession({ permissions: ["kpi.view"], terminals: [randomUUID()] });
      expect(((await api(stranger, "GET", `/api/kpi/periods/${P}`)).body as PeriodSummary).counts).toEqual({
        employees: 0,
        submitted: 0,
        drafts: 0,
        none: 0,
        late: 0,
        open_disputes: 0,
      });

      expect((await api(viewer, "GET", "/api/kpi/periods/2025-06-15")).status).toBe(422);
      const nobody = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(nobody, "GET", `/api/kpi/periods/${P}`)).status).toBe(403);
    });
  });
}
