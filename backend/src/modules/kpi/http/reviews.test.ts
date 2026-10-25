import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/reviews (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { employees, kpi_notifications, kpi_periods, kpi_review_events, kpi_reviews } = await import("backend/drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type ReviewForm = import("../types").ReviewForm;
  type EmployeeRow = import("../types").EmployeeRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P3 = "2025-03-01";
  const P4 = "2025-04-01";
  const OPEN_3 = "2025-03-25T10:00:00+05:00";
  const OPEN_4 = "2025-04-25T10:00:00+05:00";

  describe("kpi: месячные оценки", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: string[]; // item_id пунктов карты повара по порядку: attendance + 6 ручных

    const hrSession = () => withSession({ permissions: ["kpi.manage"] });
    const evaluator = async (terminal_id: string, perms = ["kpi.evaluate"]) => {
      const s = await withSession({ permissions: perms });
      await makeScope(db, s.userId, { terminal_id });
      return s;
    };
    const cook = () => makeEmployee(db, { role_code: "cook" });
    const form = async (s: Session, period: string, employeeId: string) =>
      api(s, "GET", `/api/kpi/reviews/form?period=${period}&employee_id=${employeeId}`);
    const draft = (s: Session, period: string, employee_id: string, items: unknown[]) =>
      api(s, "PUT", "/api/kpi/reviews/draft", { period, employee_id, items });
    const scores = (vals: (number | null)[]) =>
      vals.map((score, i) => ({ item_id: cookItems[i + 1], score })); // без attendance
    const FULL = [100, 100, 50, 50, 100, 100];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const hr = await hrSession();
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("черновик → отправка → процент и уведомление", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      expect(cookItems).toHaveLength(7);

      const empty = await form(ev, P3, e.id);
      expect(empty.status).toBe(200);
      expect(empty.body.review).toBeNull();
      expect(empty.body.items).toHaveLength(7);
      expect(empty.body.can_edit).toBe(true);
      expect(empty.body.needs_comment).toBe(false);
      expect(empty.body.card.code).toBe("cook");

      const d = await draft(ev, P3, e.id, scores(FULL));
      expect(d.status).toBe(200);
      const f = d.body as ReviewForm;
      expect(f.review!.status).toBe("draft");
      expect(f.review!.score_pct).toBe(83.33);
      expect(f.items[0].score).toBeNull();
      expect(f.items.slice(1).map((i) => i.score)).toEqual(FULL);
      const id = f.review!.id;

      const sub = await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      expect(sub.status).toBe(200);
      expect(sub.body.review.status).toBe("submitted");
      expect(sub.body.review.score_pct).toBe(83.33);
      expect(sub.body.review.late).toBe(false);
      expect(sub.body.needs_comment).toBe(true);

      const notes = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${id}`));
      expect(notes).toHaveLength(1);
      expect(notes[0].kind).toBe("review_submitted");
      expect(notes[0].recipient_kind).toBe("employee");
      expect(notes[0].employee_id).toBe(e.id);
      expect(notes[0].payload).toEqual({ period: P3, review_id: id, score_pct: 83.33 });

      const events = await api(ev, "GET", `/api/kpi/reviews/${id}/events`);
      expect(events.status).toBe(200);
      expect(events.body).toHaveLength(1);
      expect(events.body[0].kind).toBe("submitted");
      expect(events.body[0].new_score_pct).toBe(83.33);

      // Отправленную нельзя ни сохранить черновиком, ни отправить повторно.
      expect((await draft(ev, P3, e.id, scores(FULL))).body).toEqual({ error: "already_submitted" });
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).body).toEqual({ error: "already_submitted" });
    });

    it("отправка до 20 числа — 409 too_early, черновик можно", async () => {
      setNow("2025-03-10T10:00:00+05:00");
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const d = await draft(ev, P3, e.id, scores(FULL));
      expect(d.status).toBe(200);
      const sub = await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
      expect(sub.status).toBe(409);
      expect(sub.body.error).toBe("too_early");
    });

    it("пустой ручной пункт — 422 missing_items со списком; items в теле submit применяются", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const d = await draft(ev, P3, e.id, scores([100, 100, null, 50, 100, 100]));
      expect(d.status).toBe(200);
      const id = d.body.review.id as string;
      const bad = await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      expect(bad.status).toBe(422);
      expect(bad.body).toEqual({ error: "missing_items", items: [cookItems[3]] });
      // Всё ещё черновик.
      expect((await form(ev, P3, e.id)).body.review.status).toBe("draft");
      const ok = await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, { items: [{ item_id: cookItems[3], score: 0 }] });
      expect(ok.status).toBe(200);
      expect(ok.body.review.status).toBe("submitted");
      expect(ok.body.review.score_pct).toBe(75);
    });

    it("баллы и пункты: bad_score, unknown_item", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      for (const score of [101, -1, 50.5]) {
        const r = await draft(ev, P3, e.id, [{ item_id: cookItems[1], score }]);
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("bad_score");
      }
      const strScore = await draft(ev, P3, e.id, [{ item_id: cookItems[1], score: "50" }]);
      expect(strScore.body.error).toBe("bad_score");
      const alien = await draft(ev, P3, e.id, [{ item_id: "00000000-0000-0000-0000-000000000000", score: 50 }]);
      expect(alien.status).toBe(422);
      expect(alien.body.error).toBe("unknown_item");
      // Ошибка внутри транзакции откатывает и вставку строки оценки.
      expect(await db.select().from(kpi_reviews).where(eq(kpi_reviews.employee_id, e.id))).toHaveLength(0);
    });

    it("изменение: без комментария 422, из пробелов 422, с комментарием 200, version 2, событие changed", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const id = (await draft(ev, P3, e.id, scores(FULL))).body.review.id as string;
      await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      const change = [{ item_id: cookItems[3], score: 100 }];

      const none = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: change });
      expect(none.status).toBe(422);
      expect(none.body.error).toBe("comment_required");
      const spaces = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: "   \n  " });
      expect(spaces.status).toBe(422);
      expect(spaces.body.error).toBe("comment_required");
      const short = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: "ок" });
      expect(short.body.error).toBe("comment_required");

      const ok = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: "  Ошибся при вводе  " });
      expect(ok.status).toBe(200);
      expect(ok.body.review.version).toBe(2);
      expect(ok.body.review.score_pct).toBe(91.67);
      expect(ok.body.items[3].score).toBe(100);

      const events = (await api(ev, "GET", `/api/kpi/reviews/${id}/events`)).body as { kind: string; changes: unknown[]; comment: string; old_score_pct: number; new_score_pct: number }[];
      expect(events.map((x) => x.kind)).toEqual(["submitted", "changed"]);
      expect(events[1].changes).toEqual([{ item_id: cookItems[3], title_ru: ok.body.items[3].title_ru, old: 50, new: 100 }]);
      expect(events[1].comment).toBe("Ошибся при вводе");
      expect(events[1].old_score_pct).toBe(83.33);
      expect(events[1].new_score_pct).toBe(91.67);

      const notes = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_changed:${id}:2`));
      expect(notes).toHaveLength(1);
      expect(notes[0].kind).toBe("review_changed");
      expect((notes[0].payload as any).version).toBe(2);
      expect((notes[0].payload as any).comment).toBe("Ошибся при вводе");
      expect((notes[0].payload as any).changes).toHaveLength(1);

      // Чужой пункт, кривой балл и снятие ручного балла.
      expect((await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: "00000000-0000-0000-0000-000000000000", score: 1 }], comment: "комментарий" })).body.error).toBe("unknown_item");
      expect((await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[3], score: 200 }], comment: "комментарий" })).body.error).toBe("bad_score");
      expect((await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[3], score: null }], comment: "комментарий" })).body.error).toBe("missing_items");
    });

    it("изменение без изменений — 422 no_changes; только заметка — событие без списка изменений", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const id = (await draft(ev, P3, e.id, scores(FULL))).body.review.id as string;
      await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      const same = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[1], score: 100 }], comment: "ничего не менял" });
      expect(same.status).toBe(422);
      expect(same.body.error).toBe("no_changes");
      const empty = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [], comment: "ничего не менял" });
      expect(empty.body.error).toBe("no_changes");

      const note = await api(ev, "PUT", `/api/kpi/reviews/${id}`, {
        items: [{ item_id: cookItems[1], score: 100, note: "хорошо справился" }],
        comment: "добавил заметку",
      });
      expect(note.status).toBe(200);
      expect(note.body.items[1].note).toBe("хорошо справился");
      const events = await db.select().from(kpi_review_events).where(eq(kpi_review_events.review_id, id));
      const changed = events.find((x) => x.kind === "changed")!;
      expect(changed.changes).toEqual([]);
    });

    it("доступ: чужой оценщик 403 out_of_scope, kpi.view без evaluate читает форму, но не сохраняет", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const id = (await draft(ev, P3, e.id, scores(FULL))).body.review.id as string;
      await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});

      const stranger = await evaluator(crypto.randomUUID());
      const d = await draft(stranger, P3, e.id, scores(FULL));
      expect(d.status).toBe(403);
      expect(d.body.error).toBe("out_of_scope");
      expect((await form(stranger, P3, e.id)).body).toEqual({ error: "out_of_scope" });
      expect((await api(stranger, "GET", `/api/kpi/reviews/${id}/events`)).status).toBe(403);
      const ch = await api(stranger, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[3], score: 100 }], comment: "комментарий" });
      expect(ch.status).toBe(403);
      expect(ch.body.error).toBe("out_of_scope");

      const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: e.terminal_id });
      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [e.terminal_id] });
      const f = await form(viewer, P3, e.id);
      expect(f.status).toBe(200);
      expect(f.body.can_edit).toBe(false);
      expect(f.body.review.status).toBe("submitted");
      expect((await form(viewer, P3, e2.id)).body.can_edit).toBe(false);
      expect((await draft(viewer, P3, e2.id, scores(FULL))).status).toBe(403);
      expect((await api(viewer, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(403);
      expect((await api(viewer, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[3], score: 100 }], comment: "комментарий" })).status).toBe(403);
      expect((await api(viewer, "GET", `/api/kpi/reviews/${id}/events`)).status).toBe(200);
      // Филиал смотрящего другой — оценки не видно.
      const otherViewer = await withSession({ permissions: ["kpi.view"], terminals: [crypto.randomUUID()] });
      expect((await form(otherViewer, P3, e.id)).status).toBe(403);
      // Без kpi-прав вообще.
      const nobody = await withSession({ permissions: ["medical.list"] });
      expect((await form(nobody, P3, e.id)).status).toBe(403);
    });

    it("нет карты — 422 no_card; сотрудника нет — 404", async () => {
      setNow(OPEN_3);
      const noCard = await makeEmployee(db, {});
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: noCard.terminal_id });
      expect((await form(ev, P3, noCard.id)).body).toEqual({ error: "no_card" });
      expect((await draft(ev, P3, noCard.id, [])).body).toEqual({ error: "no_card" });
      expect((await form(ev, P3, crypto.randomUUID())).status).toBe(404);
      expect((await form(ev, P3, "not-a-uuid")).status).toBe(404);
    });

    it("два параллельных draft — оба 200, одна строка kpi_reviews", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const ev2 = await evaluator(e.terminal_id);
      const [a, b, c] = await Promise.all([
        draft(ev, P3, e.id, scores(FULL)),
        draft(ev, P3, e.id, scores(FULL)),
        draft(ev2, P3, e.id, scores(FULL)),
      ]);
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      const rows = await db.select().from(kpi_reviews).where(and(eq(kpi_reviews.employee_id, e.id), eq(kpi_reviews.period, P3)));
      expect(rows).toHaveLength(1);
      expect(a.body.review.id).toBe(rows[0].id);
      expect((await form(ev, P3, e.id)).body.items.slice(1).map((i: { score: number }) => i.score)).toEqual(FULL);
    });

    it("пункт отключили после отправки — форма показывает снимок, процент тот же; у черновика другого сотрудника пункта нет", async () => {
      setNow(OPEN_3);
      const hr = await hrSession();
      const mk = await api(hr, "POST", "/api/kpi/cards", { code: "test_snap", title_ru: "Тест снимок", title_uz: "Test", staff_role_codes: [], sort: 901 });
      const cardId = mk.body.id as string;
      const base = { title_ru: "Пункт один", title_uz: "1", source: "manual", weight: 1, group_key: "base" };
      const i1 = (await api(hr, "POST", `/api/kpi/cards/${cardId}/items`, base)).body.id as string;
      const i2 = (await api(hr, "POST", `/api/kpi/cards/${cardId}/items`, { ...base, title_ru: "Пункт два", group_key: "extra" })).body.id as string;

      const e1 = await makeEmployee(db, {});
      const e2 = await makeEmployee(db, { terminal_id: e1.terminal_id });
      for (const e of [e1, e2]) expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/card`, { card_id: cardId })).status).toBe(200);
      const ev = await evaluator(e1.terminal_id);

      const d = await draft(ev, P3, e1.id, [{ item_id: i1, score: 100 }, { item_id: i2, score: 50 }]);
      expect(d.status).toBe(200);
      expect(d.body.review.score_pct).toBe(75);
      const id = d.body.review.id as string;
      // Черновик e2 заведён до отключения пункта, но не отправлен.
      expect((await draft(ev, P3, e2.id, [{ item_id: i1, score: 10 }, { item_id: i2, score: 20 }])).status).toBe(200);
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);

      expect((await api(hr, "PUT", `/api/kpi/items/${i2}`, { active: false })).body.active).toBe(false);

      const snap = (await form(ev, P3, e1.id)).body as ReviewForm;
      expect(snap.review!.status).toBe("submitted");
      expect(snap.review!.score_pct).toBe(75);
      expect(snap.items.map((i) => [i.title_ru, i.score, i.group_key])).toEqual([
        ["Пункт один", 100, "base"],
        ["Пункт два", 50, "extra"],
      ]);

      // Черновик другого сотрудника следует текущей карте.
      const cur = (await form(ev, P3, e2.id)).body as ReviewForm;
      expect(cur.items.map((i) => i.title_ru)).toEqual(["Пункт один"]);
      const e3 = await makeEmployee(db, { terminal_id: e1.terminal_id });
      await api(hr, "PUT", `/api/kpi/employees/${e3.id}/card`, { card_id: cardId });
      expect(((await form(ev, P3, e3.id)).body as ReviewForm).items.map((i) => i.title_ru)).toEqual(["Пункт один"]);
      // Сохранение черновика пересобирает строки: баллы совпавшего пункта остаются.
      const re = await draft(ev, P3, e2.id, []);
      expect(re.body.items).toHaveLength(1);
      expect(re.body.items[0].score).toBe(10);
      expect(re.body.review.score_pct).toBe(10);
      // Отправка пересобирает по текущей карте: отключённого пункта в снимке нет.
      const sub2 = await api(ev, "POST", `/api/kpi/reviews/${re.body.review.id}/submit`, {});
      expect(sub2.status).toBe(200);
      expect(sub2.body.items).toHaveLength(1);
      expect(sub2.body.review.score_pct).toBe(10);
    });

    it("кривой период — 422 bad_period", async () => {
      const hr = await withSession({ permissions: ["kpi.view"] });
      for (const p of ["x", "2026-13-01", "2026-10-15", ""]) {
        expect((await api(hr, "GET", `/api/kpi/reviews?period=${p}`)).body).toEqual({ error: "bad_period" });
      }
      expect((await api(hr, "GET", "/api/kpi/reviews")).body).toEqual({ error: "bad_period" });
      expect((await api(hr, "GET", "/api/kpi/reviews/form?period=2026-10-15&employee_id=x")).body).toEqual({ error: "bad_period" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "PUT", "/api/kpi/reviews/draft", { period: "2026-10-02", employee_id: crypto.randomUUID(), items: [] })).body).toEqual({ error: "bad_period" });
    });

    it("late: отправка за март 9 апреля — late=true; в списке то же", async () => {
      setNow("2025-04-09T10:00:00+05:00");
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const d = await draft(ev, P3, e.id, scores(FULL));
      expect(d.body.review.late).toBe(true); // черновик после срока уже просрочен
      const sub = await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
      expect(sub.status).toBe(200);
      expect(sub.body.review.late).toBe(true);
      const list = (await api(ev, "GET", `/api/kpi/reviews?period=${P3}&terminal_id=${e.terminal_id}`)).body as EmployeeRow[];
      expect(list).toHaveLength(1);
      expect(list[0].review!.late).toBe(true);
    });

    it("список: только сотрудники с оценкой, фильтр по статусу", async () => {
      setNow(OPEN_3);
      const a = await cook();
      const b = await makeEmployee(db, { role_code: "cook", terminal_id: a.terminal_id });
      await makeEmployee(db, { role_code: "cook", terminal_id: a.terminal_id }); // без оценки
      const ev = await evaluator(a.terminal_id);
      const da = await draft(ev, P3, a.id, scores(FULL));
      const db_ = await draft(ev, P3, b.id, scores(FULL));
      await api(ev, "POST", `/api/kpi/reviews/${db_.body.review.id}/submit`, {});
      const q = (qs: string) => api(ev, "GET", `/api/kpi/reviews?period=${P3}&terminal_id=${a.terminal_id}${qs}`);
      const all = (await q("")).body as EmployeeRow[];
      expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect(((await q("&status=draft")).body as EmployeeRow[]).map((r) => r.id)).toEqual([a.id]);
      expect(((await q("&status=submitted")).body as EmployeeRow[]).map((r) => r.id)).toEqual([b.id]);
      expect(((await q("&status=none")).body as EmployeeRow[])).toEqual([]);
      expect((await q("&status=zzz")).body).toEqual({ error: "bad_status" });
      expect(da.status).toBe(200);
      // Другой месяц пуст.
      expect((await api(ev, "GET", `/api/kpi/reviews?period=${P4}&terminal_id=${a.terminal_id}`)).body).toEqual([]);
    });

    it("закрытый месяц: черновик 409, оценщик 409 period_closed, kpi.approve меняет — событие hr_adjusted", async () => {
      setNow(OPEN_4);
      const e = await cook();
      const e2 = await makeEmployee(db, { role_code: "cook", terminal_id: e.terminal_id });
      const ev = await evaluator(e.terminal_id);
      const id = (await draft(ev, P4, e.id, scores(FULL))).body.review.id as string;
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      // Строка месяца уже есть (её создаёт отправка): закрываем upsert-ом.
      await db.insert(kpi_periods).values({ period: P4, status: "closed" }).onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });

      const f = (await form(ev, P4, e.id)).body as ReviewForm;
      expect(f.period_status).toBe("closed");
      expect(f.can_edit).toBe(false);
      const change = [{ item_id: cookItems[3], score: 100 }];
      const blocked = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: "правка после закрытия" });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("period_closed");
      expect((await draft(ev, P4, e2.id, scores(FULL))).body).toEqual({ error: "period_closed" });

      const hr = await withSession({ permissions: ["kpi.approve", "kpi_layout"] });
      expect(((await form(hr, P4, e.id)).body as ReviewForm).can_edit).toBe(true);
      const noComment = await api(hr, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: " " });
      expect(noComment.body.error).toBe("comment_required");
      const ok = await api(hr, "PUT", `/api/kpi/reviews/${id}`, { items: change, comment: "корректировка HR" });
      expect(ok.status).toBe(200);
      expect(ok.body.review.version).toBe(2);
      const events = (await api(hr, "GET", `/api/kpi/reviews/${id}/events`)).body as { kind: string }[];
      expect(events.map((x) => x.kind)).toEqual(["submitted", "hr_adjusted"]);
      await db.delete(kpi_periods).where(eq(kpi_periods.period, P4));
    });

    it("kpi.approve меняет отправленную оценку в открытом месяце без назначения — событие changed", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const ev = await evaluator(e.terminal_id);
      const id = (await draft(ev, P3, e.id, scores(FULL))).body.review.id as string;
      await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      const hr = await withSession({ permissions: ["kpi.approve"] });
      const ok = await api(hr, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: cookItems[3], score: 0 }], comment: "пересмотр оценки" });
      expect(ok.status).toBe(200);
      const events = (await api(hr, "GET", `/api/kpi/reviews/${id}/events`)).body as { kind: string }[];
      expect(events.map((x) => x.kind)).toEqual(["submitted", "changed"]);
      // Изменение черновика через PUT /reviews/:id не допускается.
      const e2 = await cook();
      const ev2 = await evaluator(e2.terminal_id);
      const did = (await draft(ev2, P3, e2.id, scores(FULL))).body.review.id as string;
      const r = await api(ev2, "PUT", `/api/kpi/reviews/${did}`, { items: [{ item_id: cookItems[3], score: 0 }], comment: "пересмотр оценки" });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("not_submitted");
    });

    it("история оценки видна оценщику нового филиала сотрудника, как и форма", async () => {
      setNow(OPEN_3);
      const e = await cook();
      const evOld = await evaluator(e.terminal_id);
      const id = (await draft(evOld, P3, e.id, scores(FULL))).body.review.id as string;
      await api(evOld, "POST", `/api/kpi/reviews/${id}/submit`, {});
      const newTerminal = randomUUID();
      const evNew = await evaluator(newTerminal);
      await db.update(employees).set({ terminal_id: newTerminal }).where(eq(employees.id, e.id));
      expect((await form(evNew, P3, e.id)).status).toBe(200);
      expect((await api(evNew, "GET", `/api/kpi/reviews/${id}/events`)).status).toBe(200);
      // По снимку видит и прежний оценщик.
      expect((await api(evOld, "GET", `/api/kpi/reviews/${id}/events`)).status).toBe(200);
    });
  });
}
