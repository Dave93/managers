import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/admin-gaps (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { employees, kpi_disputes, kpi_periods, kpi_raise_decisions, kpi_reviews, kpi_violation_photos, kpi_violations, users } =
    await import("backend/drizzle/schema");
  const { uploadsBase } = await import("../storage");
  const { and, eq, like } = await import("drizzle-orm");
  type EmployeeRow = import("../types").EmployeeRow;
  type ReviewForm = import("../types").ReviewForm;
  type DisputeRow = import("../types").DisputeRow;
  type ViolationRow = import("../types").ViolationRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-08-01";
  const SUBMIT_AT = "2025-08-25T10:00:00+05:00";
  const DISPUTE_AT = "2025-09-05T10:00:00+05:00"; // окно споров августа открыто до 10 сентября
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

  describe("kpi: доработки API для админки", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let hr: Session;
    let approver: Session;
    let cardId: string;
    let itemId: string;
    const tmpFiles: string[] = [];

    const evaluator = async (terminal_id: string) => {
      const s = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, s.userId, { terminal_id });
      return s;
    };
    // Сотрудник с тестовой картой (ручное назначение).
    const carded = async (terminal_id?: string) => {
      const e = await makeEmployee(db, { terminal_id });
      expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/card`, { card_id: cardId })).status).toBe(200);
      return e;
    };
    // Отправленная оценка за август с баллом 100; возвращает id оценки.
    const submitted = async (s: Session, employeeId: string): Promise<string> => {
      setNow(SUBMIT_AT);
      const d = await api(s, "PUT", "/api/kpi/reviews/draft", {
        period: P,
        employee_id: employeeId,
        items: [{ item_id: itemId, score: 100 }],
      });
      expect(d.status).toBe(200);
      const id = d.body.review.id as string;
      expect((await api(s, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      return id;
    };
    const formOf = (s: Session, employeeId: string) =>
      api(s, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${employeeId}`);
    const photoFile = (s: Session, photoId: string) =>
      callApi(`/api/kpi/violation-photos/${photoId}/file`, { headers: { ...s.headers } });
    const makeViolation = async (e: { id: string; terminal_id: string }, recordedBy: string) => {
      const [v] = await db
        .insert(kpi_violations)
        .values({
          terminal_id: e.terminal_id,
          employee_id: e.id,
          period: P,
          occurred_at: "2025-08-10T10:00:00+05:00",
          comment: "Грязный фартук",
          recorded_by: recordedBy,
        })
        .returning();
      return v;
    };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      hr = await withSession({ permissions: ["kpi.manage"] });
      approver = await withSession({ permissions: ["kpi.approve"] });
      // Карта с одним ручным пунктом: процент оценки равен баллу.
      const mk = await api(hr, "POST", "/api/kpi/cards", {
        code: "test_gaps",
        title_ru: "Тест пробелы",
        title_uz: "Test",
        staff_role_codes: [],
        sort: 903,
      });
      expect(mk.status).toBe(200);
      cardId = mk.body.id as string;
      itemId = (
        await api(hr, "POST", `/api/kpi/cards/${cardId}/items`, {
          title_ru: "Один пункт",
          title_uz: "1",
          source: "manual",
          weight: 1,
          group_key: "base",
        })
      ).body.id as string;
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 500000 });
      await cleanupKpi(db);
      await db.delete(users).where(like(users.login, "test_gaps_%"));
      for (const f of tmpFiles) fs.rmSync(f, { force: true });
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("users: элементы ровно с ключами id, name, login", async () => {
      await db.insert(users).values([
        { login: "test_gaps_a", first_name: "Тест", last_name: "Юзер", password: "x", status: "active" },
        { login: "test_gaps_b", first_name: null, last_name: null, password: "x", status: "active" },
      ]);
      const r = await api(hr, "GET", "/api/kpi/users?search=test_gaps_");
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(2);
      for (const u of r.body) expect(Object.keys(u).sort()).toEqual(["id", "login", "name"]);
      const byLogin = new Map(r.body.map((u: { login: string; name: string }) => [u.login, u.name]));
      expect(byLogin.get("test_gaps_a")).toBe("Тест Юзер");
      expect(byLogin.get("test_gaps_b")).toBe("test_gaps_b");
    });

    it("include_uncarded=1 у kpi.manage: техничка без назначения видна с card=null; у kpi.view параметр не расширяет список", async () => {
      const terminal = randomUUID();
      const bare = await makeEmployee(db, { terminal_id: terminal }); // роли нет — карты нет
      const off = await carded(terminal);
      expect((await api(hr, "PUT", `/api/kpi/employees/${off.id}/card`, { card_id: null })).status).toBe(200);

      const list = async (s: Session, flag: string) =>
        (await api(s, "GET", `/api/kpi/employees?period=${P}&terminal_id=${terminal}${flag}`)).body as EmployeeRow[];

      expect((await list(hr, "")).map((e) => e.id)).toEqual([]);
      const all = await list(hr, "&include_uncarded=1");
      expect(all.map((e) => e.id).sort()).toEqual([bare.id, off.id].sort());
      const b = all.find((e) => e.id === bare.id)!;
      expect(b.card).toBeNull();
      expect(b.card_source).toBeNull();
      expect(b.can_evaluate).toBe(false);
      const o = all.find((e) => e.id === off.id)!;
      expect(o.card).toBeNull();
      expect(o.card_source).toBe("override");

      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [terminal] });
      expect(await list(viewer, "&include_uncarded=1")).toEqual([]);
      const approve = await withSession({ permissions: ["kpi.approve"] });
      expect(await list(approve, "&include_uncarded=1")).toEqual([]);
    });

    it("kpi.approve без view: форма, события, нарушения и фото — 200", async () => {
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const v = await makeViolation(e, ev.userId);
      const dir = `${uploadsBase()}/${v.id}`;
      fs.mkdirSync(dir, { recursive: true });
      const path = `${dir}/${randomUUID()}.png`;
      fs.writeFileSync(path, PNG);
      const [ph] = await db
        .insert(kpi_violation_photos)
        .values({ violation_id: v.id, file_path: path, mime: "image/png", size_bytes: PNG.length })
        .returning();

      const form = await formOf(approver, e.id);
      expect(form.status).toBe(200);
      expect((form.body as ReviewForm).review?.id).toBe(reviewId);
      const events = await api(approver, "GET", `/api/kpi/reviews/${reviewId}/events`);
      expect(events.status).toBe(200);
      expect(events.body.map((x: { kind: string }) => x.kind)).toEqual(["submitted"]);
      const vs = await api(approver, "GET", `/api/kpi/violations?period=${P}&employee_id=${e.id}`);
      expect(vs.status).toBe(200);
      expect((vs.body as ViolationRow[]).map((x) => x.id)).toEqual([v.id]);
      const list = await api(approver, "GET", `/api/kpi/reviews?period=${P}&terminal_id=${e.terminal_id}`);
      expect(list.status).toBe(200);
      expect((list.body as EmployeeRow[]).map((x) => x.id)).toEqual([e.id]);
      expect((await photoFile(approver, ph.id)).status).toBe(200);
    });

    it("ReviewForm.open_dispute: false без спора; true после вставки строки kpi_disputes status=open по этой оценке", async () => {
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const before = (await formOf(ev, e.id)).body as ReviewForm;
      expect(before.open_dispute).toBe(false);

      const [d] = await db
        .insert(kpi_disputes)
        .values({
          subject_type: "review",
          subject_id: reviewId,
          employee_id: e.id,
          period: P,
          opened_via: "admin",
          opened_by_user_id: ev.userId,
          reason: "Не согласен с оценкой",
          status: "open",
        })
        .returning();
      expect(((await formOf(ev, e.id)).body as ReviewForm).open_dispute).toBe(true);
      await db.update(kpi_disputes).set({ status: "rejected" }).where(eq(kpi_disputes.id, d.id));
      expect(((await formOf(ev, e.id)).body as ReviewForm).open_dispute).toBe(false);

      // Черновик и сотрудник без оценки: флага нет.
      const fresh = await carded(e.terminal_id);
      const draft = await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: fresh.id, items: [] });
      expect(draft.status).toBe(200);
      expect((draft.body as ReviewForm).open_dispute).toBe(false);
    });

    it("фото: ответ с nosniff и Cache-Control private; строка фото с file_path вне uploadsBase — 404", async () => {
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const v = await makeViolation(e, ev.userId);
      const dir = `${uploadsBase()}/${v.id}`;
      fs.mkdirSync(dir, { recursive: true });
      const inside = `${dir}/${randomUUID()}.png`;
      fs.writeFileSync(inside, PNG);
      // Файл существует, но лежит вне каталога загрузок; путь с ".." тоже не проходит.
      const outside = `/tmp/kpi_gaps_outside_${randomUUID()}.png`;
      fs.writeFileSync(outside, PNG);
      tmpFiles.push(outside);
      const [okRow, outRow, dotRow] = await db
        .insert(kpi_violation_photos)
        .values([
          { violation_id: v.id, file_path: inside, mime: "image/png", size_bytes: PNG.length },
          { violation_id: v.id, file_path: outside, mime: "image/png", size_bytes: PNG.length },
          { violation_id: v.id, file_path: `${dir}/../../../..${outside}`, mime: "image/png", size_bytes: PNG.length },
        ])
        .returning();

      const ok = await photoFile(ev, okRow.id);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
      expect(ok.headers.get("cache-control")).toBe("private, max-age=3600");
      expect(ok.headers.get("content-type")).toContain("image/png");
      for (const row of [outRow, dotRow]) {
        const r = await photoFile(ev, row.id);
        expect(r.status).toBe(404);
        expect(await r.json()).toEqual({ error: "not_found" });
      }
    });

    it("решение по умолчанию при raise_cap ниже предложения — 422 bad_amount", async () => {
      const e = await carded();
      const [row] = await db
        .insert(kpi_raise_decisions)
        .values({
          quarter_start: "2025-07-01",
          employee_id: e.id,
          terminal_id: e.terminal_id,
          card_id: cardId,
          months: [],
          months_scored: 3,
          avg_pct: "94.00",
          suggested_amount: "300000",
          status: "proposed",
        })
        .returning();
      for (const p of ["2025-07-01", "2025-08-01", "2025-09-01"]) {
        await db.insert(kpi_periods).values({ period: p, status: "closed" }).onConflictDoUpdate({
          target: kpi_periods.period,
          set: { status: "closed" },
        });
      }
      try {
        expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 100000 })).status).toBe(200);
        const bad = await api(approver, "POST", `/api/kpi/raises/${row.id}/decide`, { status: "approved" });
        expect(bad.status).toBe(422);
        expect(bad.body).toEqual({ error: "bad_amount" });
        expect((await db.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, row.id)))[0].status).toBe("proposed");
        // Потолок вернули: то же решение проходит.
        expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 500000 })).status).toBe(200);
        const ok = await api(approver, "POST", `/api/kpi/raises/${row.id}/decide`, { status: "approved" });
        expect(ok.status).toBe(200);
        expect(ok.body.approved_amount).toBe(300000);
      } finally {
        await db.delete(kpi_periods);
      }
    });

    it("история решения хранит decided_at в ISO", async () => {
      const e = await carded();
      const [row] = await db
        .insert(kpi_raise_decisions)
        .values({
          quarter_start: "2025-07-01",
          employee_id: e.id,
          terminal_id: e.terminal_id,
          card_id: cardId,
          months: [],
          months_scored: 3,
          avg_pct: "94.00",
          suggested_amount: "300000",
          status: "proposed",
        })
        .returning();
      for (const p of ["2025-07-01", "2025-08-01", "2025-09-01"]) {
        await db.insert(kpi_periods).values({ period: p, status: "closed" }).onConflictDoUpdate({
          target: kpi_periods.period,
          set: { status: "closed" },
        });
      }
      try {
        const decide = (body: unknown) => api(approver, "POST", `/api/kpi/raises/${row.id}/decide`, body);
        expect((await decide({ status: "approved" })).status).toBe(200);
        expect((await decide({ status: "rejected", comment: "Передумали" })).status).toBe(200);
        const [fresh] = await db.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, row.id));
        const hist = fresh.history as { decided_at: string }[];
        expect(hist).toHaveLength(1);
        expect(hist[0].decided_at).toBe(new Date(hist[0].decided_at).toISOString());
      } finally {
        await db.delete(kpi_periods);
      }
    });

    it("спор по оценке после перевода сотрудника: оценщик нового филиала (без назначения на старый) видит can_resolve=true и принимает спор — 200", async () => {
      const A = randomUUID();
      const B = randomUUID();
      const e = await carded(A);
      const evA = await evaluator(A);
      const reviewId = await submitted(evA, e.id);
      setNow(DISPUTE_AT);
      const opened = await api(evA, "POST", "/api/kpi/disputes", {
        subject_type: "review",
        subject_id: reviewId,
        reason: "Не согласен с оценкой",
      });
      expect(opened.status).toBe(200);
      const disputeId = (opened.body as DisputeRow).id;

      // Сотрудника перевели в другой филиал.
      await db.update(employees).set({ terminal_id: B }).where(eq(employees.id, e.id));
      const evB = await evaluator(B);

      const list = await api(evB, "GET", "/api/kpi/disputes?status=open");
      expect(list.status).toBe(200);
      const mine = (list.body as DisputeRow[]).find((d) => d.id === disputeId)!;
      expect(mine.can_resolve).toBe(true);

      const res = await api(evB, "POST", `/api/kpi/disputes/${disputeId}/resolve`, {
        decision: "accepted",
        comment: "Оценка пересмотрена",
        items: [{ item_id: itemId, score: 50 }],
      });
      expect(res.status).toBe(200);
      expect((res.body as DisputeRow).status).toBe("accepted");
      const [rv] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, reviewId));
      expect(Number(rv.score_pct)).toBe(50);
      expect(rv.version).toBe(2);

      // Посторонний оценщик по-прежнему не может ни разобрать спор, ни менять оценку напрямую.
      const stranger = await evaluator(randomUUID());
      const other = await carded(A);
      const otherReview = await submitted(evA, other.id);
      setNow(DISPUTE_AT);
      const d2 = await api(evA, "POST", "/api/kpi/disputes", { subject_type: "review", subject_id: otherReview, reason: "Не согласен с оценкой" });
      expect(d2.status).toBe(200);
      const denied = await api(stranger, "POST", `/api/kpi/disputes/${d2.body.id}/resolve`, {
        decision: "accepted",
        comment: "Оценка пересмотрена",
        items: [{ item_id: itemId, score: 50 }],
      });
      expect(denied.status).toBe(403);
      expect(
        (await db.select().from(kpi_disputes).where(and(eq(kpi_disputes.id, d2.body.id), eq(kpi_disputes.status, "open")))).length
      ).toBe(1);
    });
  });
}
