import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/final-fixes (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, expectIsoTimestamps, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_cards, kpi_notifications, kpi_periods, kpi_raise_decisions, kpi_reviews, kpi_violations } = await import(
    "backend/drizzle/schema"
  );
  const { seedCards } = await import("../seed-cards");
  const { and, eq } = await import("drizzle-orm");
  type EmployeeRow = import("../types").EmployeeRow;
  type RaiseRow = import("../types").RaiseRow;
  type ReviewForm = import("../types").ReviewForm;
  type Tier = import("../types").Tier;
  type ViolationRow = import("../types").ViolationRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  // Свои месяцы: квартал Q4 2025, основной месяц — декабрь.
  const OCT = "2025-10-01";
  const NOV = "2025-11-01";
  const P = "2025-12-01";
  const Q = OCT;
  const SUBMIT_AT: Record<string, string> = {
    [OCT]: "2025-10-25T10:00:00+05:00",
    [NOV]: "2025-11-25T10:00:00+05:00",
    [P]: "2025-12-25T10:00:00+05:00",
  };
  const MID_DEC = "2025-12-15T12:00:00+05:00";
  const DISPUTE_AT = "2026-01-05T10:00:00+05:00"; // окно споров декабря открыто до 10 января
  const CLOSE_AT = "2026-01-11T12:00:00+05:00"; // окна споров октября–декабря закрыты
  const T1 = "2026-01-12T10:00:00+05:00";
  const T2 = "2026-01-13T10:00:00+05:00";
  const T3 = "2026-01-14T10:00:00+05:00";
  const T4 = "2026-01-15T10:00:00+05:00";

  describe("kpi: доработки по финальному ревью", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let hr: Session;
    let approver: Session;
    let cardId: string;
    let emptyCardId: string;
    let itemId: string;
    // Оспоренная и разобранная оценка декабря: её смотрит проверка формата времени в конце.
    let shared: { ev: Session; employeeId: string; reviewId: string };

    const evaluator = async (terminal_id: string, perms = ["kpi.evaluate"]) => {
      const s = await withSession({ permissions: perms });
      await makeScope(db, s.userId, { terminal_id });
      return s;
    };
    // Сотрудник с тестовой картой (ручное назначение).
    const carded = async (terminal_id?: string, card = cardId) => {
      const e = await makeEmployee(db, { terminal_id });
      expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/card`, { card_id: card })).status).toBe(200);
      return e;
    };
    // Отправленная оценка за месяц p; возвращает id оценки.
    const submitted = async (s: Session, employeeId: string, p = P, score = 100): Promise<string> => {
      setNow(SUBMIT_AT[p]);
      const d = await api(s, "PUT", "/api/kpi/reviews/draft", { period: p, employee_id: employeeId, items: [{ item_id: itemId, score }] });
      expect(d.status).toBe(200);
      const id = d.body.review.id as string;
      expect((await api(s, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      return id;
    };
    const insertViolation = async (e: { id: string; terminal_id: string }, recordedBy: string, comment = "Грязный фартук") => {
      const [v] = await db
        .insert(kpi_violations)
        .values({
          terminal_id: e.terminal_id,
          employee_id: e.id,
          period: P,
          occurred_at: "2025-12-10T10:00:00+05:00",
          comment,
          recorded_by: recordedBy,
        })
        .returning();
      return v;
    };
    const postForm = async (s: Session, fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const res = await callApi("/api/kpi/violations", { method: "POST", headers: { ...s.headers }, body: fd });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status, body };
    };
    const formOf = (s: Session, employeeId: string) =>
      api(s, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${employeeId}`);
    const raiseOf = async (employeeId: string) =>
      ((await api(approver, "GET", `/api/kpi/raises?quarter=${Q}`)).body as RaiseRow[]).find((r) => r.employee_id === employeeId)!;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      hr = await withSession({ permissions: ["kpi.manage"] });
      approver = await withSession({ permissions: ["kpi.approve"] });
      // Карта с одним ручным пунктом: процент оценки равен баллу.
      const mk = await api(hr, "POST", "/api/kpi/cards", {
        code: "test_final",
        title_ru: "Тест финал",
        title_uz: "Test",
        staff_role_codes: [],
        sort: 904,
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
      // Карта без единого пункта.
      const empty = await api(hr, "POST", "/api/kpi/cards", {
        code: "test_final_empty",
        title_ru: "Тест пустая",
        title_uz: "Test",
        staff_role_codes: [],
        sort: 905,
      });
      expect(empty.status).toBe(200);
      emptyCardId = empty.body.id as string;
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("attestation.hq с одним kpi.evaluate не открывает сеть: чужой филиал не виден в списках, форма — 403", async () => {
      setNow(MID_DEC);
      const A = randomUUID();
      const B = randomUUID();
      const eA = await carded(A);
      const eB = await carded(B);
      const vA = await insertViolation(eA, hr.userId);
      const vB = await insertViolation(eB, hr.userId);

      const hqEv = await evaluator(A, ["kpi.evaluate", "attestation.hq"]);
      const me = await api(hqEv, "GET", "/api/kpi/me");
      expect(me.status).toBe(200);
      expect(me.body.is_hq).toBe(true); // головной офис распознан, иначе проверка ниже ничего не доказывает

      const emps = ((await api(hqEv, "GET", `/api/kpi/employees?period=${P}`)).body as EmployeeRow[]).map((e) => e.id);
      expect(emps).toContain(eA.id);
      expect(emps).not.toContain(eB.id);
      expect((await api(hqEv, "GET", `/api/kpi/employees?period=${P}&terminal_id=${B}`)).body).toEqual([]);
      const vs = ((await api(hqEv, "GET", `/api/kpi/violations?period=${P}`)).body as ViolationRow[]).map((v) => v.id);
      expect(vs).toContain(vA.id);
      expect(vs).not.toContain(vB.id);
      const f = await formOf(hqEv, eB.id);
      expect(f.status).toBe(403);
      expect(f.body).toEqual({ error: "out_of_scope" });
      expect((await formOf(hqEv, eA.id)).status).toBe(200);

      // Головной офис с kpi.view видит всю сеть, как и раньше.
      const hqView = await withSession({ permissions: ["kpi.view", "attestation.hq"] });
      const all = (await api(hqView, "GET", `/api/kpi/employees?period=${P}&terminal_id=${B}`)).body as EmployeeRow[];
      expect(all.map((e) => e.id)).toEqual([eB.id]);
      const allV = ((await api(hqView, "GET", `/api/kpi/violations?period=${P}&employee_id=${eB.id}`)).body as ViolationRow[]).map((v) => v.id);
      expect(allV).toEqual([vB.id]);
      expect((await formOf(hqView, eB.id)).status).toBe(200);
    });

    it("occurred_at: без смещения и раньше начала прошлого месяца — 422 bad_occurred_at; граница 1 ноября 00:00 по Ташкенту проходит", async () => {
      setNow(MID_DEC);
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const base = { employee_id: e.id, comment: "Нарушение" };
      for (const bad of [
        "2025-12-10T09:00:00", // без смещения
        "2025-12-10T09:00", // без смещения
        "2025-12-10", // только дата
        "2025-12-10T09:00:00+0500", // смещение не ±hh:mm
        "2025-10-31T23:59:59+05:00", // раньше 1 ноября по Ташкенту
        "2025-10-31T18:59:59Z",
      ]) {
        const r = await postForm(ev, { ...base, occurred_at: bad });
        expect(`${bad}: ${r.status} ${JSON.stringify(r.body)}`).toBe(`${bad}: 422 {"error":"bad_occurred_at"}`);
      }
      const edge = await postForm(ev, { ...base, occurred_at: "2025-11-01T00:00:00+05:00" });
      expect(edge.status).toBe(200);
      expect(edge.body.period).toBe(NOV);
      expect(edge.body.occurred_at).toBe("2025-10-31T19:00:00.000Z");
      const zulu = await postForm(ev, { ...base, occurred_at: "2025-10-31T19:00:00Z" });
      expect(zulu.status).toBe(200);
      expect(zulu.body.period).toBe(NOV);
      const dec = await postForm(ev, { ...base, occurred_at: "2025-12-10T04:00:00.000Z" });
      expect(dec.status).toBe(200);
      expect(dec.body.period).toBe(P);
    });

    it("карта без активных пунктов: черновик сохраняется, отправка — 422 no_items без уведомления", async () => {
      setNow(SUBMIT_AT[P]);
      const e = await carded(undefined, emptyCardId);
      const ev = await evaluator(e.terminal_id);
      const d = await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: e.id, items: [] });
      expect(d.status).toBe(200);
      expect((d.body as ReviewForm).items).toEqual([]);
      const id = d.body.review.id as string;
      const s = await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      expect(s.status).toBe(422);
      expect(s.body).toEqual({ error: "no_items" });
      const [rv] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, id));
      expect(rv.status).toBe("draft");
      expect(rv.submitted_at).toBeNull();
      expect(await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${id}`))).toEqual([]);
    });

    it("открытый спор: PUT оценки и отмена нарушения — 409 open_dispute у оценщика и HR; разбор спора проходит, после него правка снова доступна", async () => {
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const reviewId = await submitted(ev, e.id);
      const v = await insertViolation(e, ev.userId, "Спорное нарушение");
      await insertViolation(e, ev.userId, "Бесспорное нарушение"); // остаётся активным: его покажет форма
      shared = { ev, employeeId: e.id, reviewId };

      setNow(DISPUTE_AT);
      // Комментарий из одной пунктуации не считается (п. 10).
      const punct = await api(ev, "POST", "/api/kpi/disputes", { subject_type: "review", subject_id: reviewId, reason: "!!!!!!!!" });
      expect(punct.status).toBe(422);
      expect(punct.body).toEqual({ error: "comment_required", min: 5 });
      const dr = await api(ev, "POST", "/api/kpi/disputes", { subject_type: "review", subject_id: reviewId, reason: "Не согласен с оценкой" });
      expect(dr.status).toBe(200);
      const dv = await api(ev, "POST", "/api/kpi/disputes", { subject_type: "violation", subject_id: v.id, reason: "Фартук был чистый" });
      expect(dv.status).toBe(200);

      const change = [{ item_id: itemId, score: 80 }];
      for (const s of [ev, approver]) {
        const r = await api(s, "PUT", `/api/kpi/reviews/${reviewId}`, { items: change, comment: "Правка во время спора" });
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: "open_dispute" });
        const c = await api(s, "POST", `/api/kpi/violations/${v.id}/cancel`, { reason: "Отмена во время спора" });
        expect(c.status).toBe(409);
        expect(c.body).toEqual({ error: "open_dispute" });
      }
      const [rv] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, reviewId));
      expect(rv.version).toBe(1);
      expect(Number(rv.score_pct)).toBe(100);
      expect((await db.select().from(kpi_violations).where(eq(kpi_violations.id, v.id)))[0].status).toBe("active");

      // Разбор спора меняет оценку и отменяет нарушение своим путём.
      const rr = await api(ev, "POST", `/api/kpi/disputes/${dr.body.id}/resolve`, { decision: "accepted", comment: "Пересмотрел оценку", items: change });
      expect(rr.status).toBe(200);
      const rvv = await api(approver, "POST", `/api/kpi/disputes/${dv.body.id}/resolve`, { decision: "accepted", comment: "Нарушение снято" });
      expect(rvv.status).toBe(200);
      const [after] = await db.select().from(kpi_reviews).where(eq(kpi_reviews.id, reviewId));
      expect(after.version).toBe(2);
      expect(Number(after.score_pct)).toBe(80);
      expect((await db.select().from(kpi_violations).where(eq(kpi_violations.id, v.id)))[0].status).toBe("cancelled");

      const again = await api(ev, "PUT", `/api/kpi/reviews/${reviewId}`, { items: [{ item_id: itemId, score: 90 }], comment: "Правка после спора" });
      expect(again.status).toBe(200);
      expect(again.body.review.version).toBe(3);
    });

    it("закрытие месяца в процессе: черновик и нарушение ждут блокировку месяца и получают 409 period_closed", async () => {
      setNow(SUBMIT_AT[P]);
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      await db.insert(kpi_periods).values({ period: P, status: "open" }).onConflictDoNothing();

      // Транзакция-«закрытие»: строка месяца под FOR UPDATE, статус уже closed, но ещё не зафиксирован.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let markLocked!: () => void;
      const locked = new Promise<void>((r) => (markLocked = r));
      const holder = db.transaction(async (tx) => {
        await tx.select().from(kpi_periods).where(eq(kpi_periods.period, P)).for("update");
        await tx.update(kpi_periods).set({ status: "closed" }).where(eq(kpi_periods.period, P));
        markLocked();
        await gate;
      });
      await locked;
      try {
        const done = { draft: false, violation: false };
        const draft = api(ev, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: e.id, items: [{ item_id: itemId, score: 100 }] }).finally(
          () => (done.draft = true)
        );
        const viol = postForm(ev, { employee_id: e.id, comment: "Нарушение во время закрытия", occurred_at: "2025-12-20T10:00:00+05:00" }).finally(
          () => (done.violation = true)
        );
        await Bun.sleep(700);
        // Без FOR SHARE оба запроса прочли бы старый статус open и записали строку.
        expect(done).toEqual({ draft: false, violation: false });
        release();
        await holder;
        const [d, v] = await Promise.all([draft, viol]);
        expect(d.status).toBe(409);
        expect(d.body).toEqual({ error: "period_closed" });
        expect(v.status).toBe(409);
        expect(v.body).toEqual({ error: "period_closed" });
        expect(await db.select().from(kpi_reviews).where(eq(kpi_reviews.employee_id, e.id))).toEqual([]);
        expect(await db.select().from(kpi_violations).where(eq(kpi_violations.employee_id, e.id))).toEqual([]);
      } finally {
        release();
        await holder.catch(() => {});
        await db.update(kpi_periods).set({ status: "open" }).where(eq(kpi_periods.period, P));
      }
    });

    it("PUT /kpi/settings: raise_cap ниже суммы ступени — 422 cap_below_tiers; после понижения шкалы проходит", async () => {
      const tiers = (await api(hr, "GET", "/api/kpi/raise-tiers")).body as Tier[];
      const max = Math.max(...tiers.map((t) => t.amount));
      expect(max).toBe(500000);
      const low = await api(hr, "PUT", "/api/kpi/settings", { raise_cap: max - 1 });
      expect(low.status).toBe(422);
      expect(low.body).toEqual({ error: "cap_below_tiers" });
      expect((await api(hr, "GET", "/api/kpi/settings")).body.raise_cap).toBe(500000);
      expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: max })).status).toBe(200);
      try {
        expect((await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 90, amount: 100000 }] })).status).toBe(200);
        expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 100000 })).status).toBe(200);
        expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 99999 })).body).toEqual({ error: "cap_below_tiers" });
      } finally {
        expect((await api(hr, "PUT", "/api/kpi/settings", { raise_cap: 500000 })).status).toBe(200);
        expect((await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers })).status).toBe(200);
      }
    });

    it("устаревший расчёт: правка HR после пересчёта → stale, решение 409 stale; пересчёт снимает; решённую строку пересчёт не трогает", async () => {
      const e = await carded();
      const ev = await evaluator(e.terminal_id);
      const ids: Record<string, string> = {};
      for (const [p, score] of [[OCT, 92], [NOV, 96], [P, 94]] as const) ids[p] = await submitted(ev, e.id, p, score);
      setNow(CLOSE_AT);
      for (const p of [OCT, NOV, P]) {
        const c = await api(approver, "POST", `/api/kpi/periods/${p}/close`, {});
        expect(`${p}: ${c.status} ${c.status === 200 ? "" : JSON.stringify(c.body)}`).toBe(`${p}: 200 `);
      }

      setNow(T1);
      expect((await api(approver, "POST", "/api/kpi/raises/compute", { quarter: Q })).status).toBe(200);
      let row = await raiseOf(e.id);
      expect(row.status).toBe("proposed");
      expect(row.stale).toBe(false);
      expect(row.suggested_amount).toBe(300000);

      // HR правит оценку закрытого ноября: расчёт устарел.
      setNow(T2);
      const adj = await api(approver, "PUT", `/api/kpi/reviews/${ids[NOV]}`, { items: [{ item_id: itemId, score: 86 }], comment: "Корректировка после закрытия" });
      expect(adj.status).toBe(200);
      const kinds = ((await api(approver, "GET", `/api/kpi/reviews/${ids[NOV]}/events`)).body as { kind: string }[]).map((x) => x.kind);
      expect(kinds).toEqual(["submitted", "hr_adjusted"]);
      row = await raiseOf(e.id);
      expect(row.stale).toBe(true);
      const decide = (body: unknown) => api(approver, "POST", `/api/kpi/raises/${row.id}/decide`, body);
      for (const body of [{ status: "approved" }, { status: "rejected", comment: "Отказ по устаревшему расчёту" }]) {
        const r = await decide(body);
        expect(r.status).toBe(409);
        expect(r.body).toEqual({ error: "stale" });
      }
      expect((await db.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, row.id)))[0].status).toBe("proposed");

      setNow(T3);
      expect((await api(approver, "POST", "/api/kpi/raises/compute", { quarter: Q })).status).toBe(200);
      row = await raiseOf(e.id);
      expect(row.stale).toBe(false);
      expect(row.avg_pct).toBe(90.67);
      const ok = await decide({ status: "approved" });
      expect(ok.status).toBe(200);
      expect(ok.body.approved_amount).toBe(300000);
      expect(ok.body.stale).toBe(false);

      // Решённую строку пересчёт не трогает (спека 7.6): stale виден, повторное решение с комментарием проходит.
      setNow(T4);
      expect(
        (await api(approver, "PUT", `/api/kpi/reviews/${ids[NOV]}`, { items: [{ item_id: itemId, score: 70 }], comment: "Ещё одна корректировка" })).status
      ).toBe(200);
      expect((await api(approver, "POST", "/api/kpi/raises/compute", { quarter: Q })).status).toBe(200);
      row = await raiseOf(e.id);
      expect(row.status).toBe("approved");
      expect(row.avg_pct).toBe(90.67);
      expect(row.stale).toBe(true);
      const re = await decide({ status: "approved", amount: 150000, comment: "Пересмотр после корректировки" });
      expect(re.status).toBe(200);
      expect(re.body.approved_amount).toBe(150000);
      expect(re.body.stale).toBe(true);
    });

    it("время в ответах — ISO 8601 UTC во всех списках и формах", async () => {
      const { ev, employeeId, reviewId } = shared;
      expectIsoTimestamps((await api(ev, "GET", `/api/kpi/employees?period=${P}`)).body, ["submitted_at"]);
      expectIsoTimestamps((await api(ev, "GET", `/api/kpi/reviews?period=${P}`)).body, ["submitted_at"]);
      expectIsoTimestamps((await formOf(ev, employeeId)).body, [
        "submitted_at",
        "occurred_at",
        "created_at",
        "submit_opens_at",
        "review_deadline",
        "dispute_deadline",
      ]);
      expectIsoTimestamps((await api(ev, "GET", `/api/kpi/reviews/${reviewId}/events`)).body, ["created_at"]);
      expectIsoTimestamps((await api(ev, "GET", "/api/kpi/me")).body, ["created_at", "review_deadline"]);
      expectIsoTimestamps((await api(hr, "GET", "/api/kpi/evaluators")).body, ["created_at"]);
      const created = await api(hr, "POST", "/api/kpi/evaluators", { user_id: ev.userId, card_id: cardId, terminal_id: null });
      expect(created.status).toBe(200);
      expectIsoTimestamps(created.body, ["created_at"]);
      expectIsoTimestamps((await api(approver, "GET", `/api/kpi/periods/${P}`)).body, ["closed_at", "dispute_deadline"]);
      expectIsoTimestamps((await api(approver, "GET", `/api/kpi/raises?quarter=${Q}`)).body, ["decided_at"]);
      expectIsoTimestamps((await api(approver, "GET", `/api/kpi/disputes?period=${P}`)).body, ["created_at", "resolved_at"]);
      expectIsoTimestamps((await api(approver, "GET", `/api/kpi/violations?period=${P}`)).body, ["occurred_at", "created_at"]);
    });

    it("seed-cards: скрипт запускается сам и идемпотентен; карта с битым пунктом не остаётся без пунктов", async () => {
      // Скрипт пишет в базу из DATABASE_URL: запускаем только против тестовой.
      const url = process.env.DATABASE_URL ?? "";
      expect(url.endsWith("/managers_tickets_test")).toBe(true);
      const proc = Bun.spawn([process.execPath, "run", "src/modules/kpi/seed-cards.ts"], {
        cwd: path.resolve(import.meta.dir, "../../../.."),
        env: { ...process.env, DATABASE_URL: url },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const out = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      expect(`${code} ${err}`).toBe("0 ");
      expect(out).toContain("cards 0"); // стартовые карты уже есть, повторный запуск ничего не добавляет

      const good = { title_ru: "Нормальный пункт", title_uz: "1", source: "manual" as const, group_key: "base" as const };
      const broken = { ...good, title_ru: "х".repeat(301) }; // длиннее varchar(300)
      const card = { code: "test_seed_atomic", title_ru: "Тест атомарность", title_uz: "Test", staff_role_codes: [], sort: 990, items: [good, broken] };
      await expect(seedCards(db, [card])).rejects.toThrow();
      expect(await db.select().from(kpi_cards).where(eq(kpi_cards.code, "test_seed_atomic"))).toEqual([]);
      // Та же карта с целыми пунктами ложится полностью.
      expect((await seedCards(db, [{ ...card, items: [good] }])).cards).toBe(1);
      const [row] = await db.select().from(kpi_cards).where(and(eq(kpi_cards.code, "test_seed_atomic"), eq(kpi_cards.sort, 990)));
      expect(row).toBeTruthy();
    });
  });
}
