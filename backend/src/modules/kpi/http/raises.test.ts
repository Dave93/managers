import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/raises (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_notifications, kpi_raise_decisions, kpi_reviews } = await import("backend/drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  type RaiseRow = import("../types").RaiseRow;
  type Tier = import("../types").Tier;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const Q = "2025-07-01";
  const MONTHS = ["2025-07-01", "2025-08-01", "2025-09-01"];
  const OPEN_AT = ["2025-07-25T10:00:00+05:00", "2025-08-25T10:00:00+05:00", "2025-09-25T10:00:00+05:00"];
  const OPEN_NOW = "2025-10-05T10:00:00+05:00"; // сентябрь ещё не закрыт
  const CLOSE_NOW = "2025-10-11T12:00:00+05:00"; // окно споров сентября закрылось 10 октября
  const DEFAULT_TIERS: Tier[] = [
    { min_pct: 95, amount: 500000 },
    { min_pct: 90, amount: 300000 },
    { min_pct: 85, amount: 150000 },
  ];

  describe("kpi: квартальные повышения", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let terminal: string;
    let hr: Session;
    let approver: Session;
    let evaluator: Session;
    let itemId: string;
    let A: { id: string }; // 92, 96, 94
    let B: { id: string }; // одна оценка
    let D: { id: string }; // 92, 96, 94, для проверок решений

    const sub = async (employee: { id: string }, month: number, score: number) => {
      setNow(OPEN_AT[month]);
      const d = await api(evaluator, "PUT", "/api/kpi/reviews/draft", {
        period: MONTHS[month],
        employee_id: employee.id,
        items: [{ item_id: itemId, score }],
      });
      expect(d.status).toBe(200);
      const r = await api(evaluator, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
      expect(r.status).toBe(200);
    };
    const compute = (s: Session = approver, quarter: unknown = Q) => api(s, "POST", "/api/kpi/raises/compute", { quarter });
    const rows = async (s: Session = approver) => (await api(s, "GET", `/api/kpi/raises?quarter=${Q}`)).body as RaiseRow[];
    const rowOf = async (e: { id: string }) => (await rows()).find((r) => r.employee_id === e.id)!;
    const decide = (id: string, body: unknown) => api(approver, "POST", `/api/kpi/raises/${id}/decide`, body);
    const dbRow = async (id: string) => (await db.select().from(kpi_raise_decisions).where(eq(kpi_raise_decisions.id, id)))[0];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      terminal = randomUUID();
      hr = await withSession({ permissions: ["kpi.manage"] });
      approver = await withSession({ permissions: ["kpi.approve"] });
      evaluator = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, evaluator.userId, { terminal_id: terminal });

      // Карта с одним ручным пунктом: процент оценки равен баллу.
      const mk = await api(hr, "POST", "/api/kpi/cards", { code: "test_raise", title_ru: "Тест повышение", title_uz: "Test", staff_role_codes: [], sort: 902 });
      const cardId = mk.body.id as string;
      itemId = (await api(hr, "POST", `/api/kpi/cards/${cardId}/items`, { title_ru: "Один пункт", title_uz: "1", source: "manual", weight: 1, group_key: "base" })).body.id as string;
      [A, B, D] = await Promise.all([0, 1, 2].map(() => makeEmployee(db, { terminal_id: terminal })));
      for (const e of [A, B, D]) expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/card`, { card_id: cardId })).status).toBe(200);
      for (const e of [A, D]) {
        await sub(e, 0, 92);
        await sub(e, 1, 96);
        await sub(e, 2, 94);
      }
      await sub(B, 0, 80);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: DEFAULT_TIERS });
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("пример плана: 92, 96, 94 → avg 94, proposed 300000", async () => {
      setNow(OPEN_NOW);
      const r = await compute();
      expect(r.status).toBe(200);
      const row = (r.body as RaiseRow[]).find((x) => x.employee_id === A.id)!;
      expect(row.months).toEqual([
        { period: "2025-07-01", score_pct: 92 },
        { period: "2025-08-01", score_pct: 96 },
        { period: "2025-09-01", score_pct: 94 },
      ]);
      expect(row.months_scored).toBe(3);
      expect(row.avg_pct).toBe(94);
      expect(row.status).toBe("proposed");
      expect(row.suggested_amount).toBe(300000);
      expect(row.approved_amount).toBeNull();
      expect(row.periods_closed).toBe(false);
      expect(row.employee_name).toContain("Тест Повар");
      expect(row.card_title).toBe("Тест повышение");
    });

    it("одна оценка → insufficient, 0", async () => {
      const row = await rowOf(B);
      expect(row.status).toBe("insufficient");
      expect(row.suggested_amount).toBe(0);
      expect(row.months_scored).toBe(1);
      expect(row.months.map((m) => m.score_pct)).toEqual([80, null, null]);
    });

    it("кривой квартал — 422 bad_quarter; права на compute и чтение", async () => {
      for (const q of ["2025-08-01", "x", "", "2025-13-01", 5]) {
        expect((await compute(approver, q)).body).toEqual({ error: "bad_quarter" });
      }
      expect((await api(approver, "GET", "/api/kpi/raises?quarter=2025-02-01")).body).toEqual({ error: "bad_quarter" });
      expect((await api(approver, "GET", "/api/kpi/raises")).body).toEqual({ error: "bad_quarter" });
      expect((await api(approver, "GET", "/api/kpi/raises/export?quarter=2025-02-01")).status).toBe(422);
      const viewer = await withSession({ permissions: ["kpi.view"], terminals: [terminal] });
      expect((await compute(viewer)).status).toBe(403);
      expect((await api(viewer, "POST", `/api/kpi/raises/${randomUUID()}/decide`, { status: "approved" })).status).toBe(403);
      expect((await api(viewer, "GET", `/api/kpi/raises/export?quarter=${Q}`)).status).toBe(403);
      const nobody = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(nobody, "GET", `/api/kpi/raises?quarter=${Q}`)).status).toBe(403);
      expect((await api(null, "GET", `/api/kpi/raises?quarter=${Q}`)).status).toBe(401);
    });

    it("видимость: kpi.view — только свои филиалы из снимка", async () => {
      const mine = await withSession({ permissions: ["kpi.view"], terminals: [terminal] });
      const other = await withSession({ permissions: ["kpi.view"], terminals: [randomUUID()] });
      expect((await rows(mine)).map((r) => r.employee_id).sort()).toEqual([A.id, B.id, D.id].sort());
      expect(await rows(other)).toEqual([]);
      expect((await rows(hr)).length).toBe(3);
    });

    it("решение при открытом месяце — 409 periods_open; после закрытия трёх месяцев — 200", async () => {
      setNow(OPEN_NOW);
      const row = await rowOf(A);
      const early = await decide(row.id, { status: "approved" });
      expect(early.status).toBe(409);
      expect(early.body).toEqual({ error: "periods_open" });

      setNow(CLOSE_NOW);
      for (const p of MONTHS) {
        const c = await api(approver, "POST", `/api/kpi/periods/${p}/close`, {});
        expect(c.status).toBe(200);
      }
      expect((await rowOf(A)).periods_closed).toBe(true);
      expect((await decide(randomUUID(), { status: "approved" })).status).toBe(404);
      expect((await decide("не-uuid", { status: "approved" })).status).toBe(404);

      const ok = await decide(row.id, { status: "approved" });
      expect(ok.status).toBe(200);
      const body = ok.body as RaiseRow;
      expect(body.status).toBe("approved");
      expect(body.approved_amount).toBe(300000);
      expect(body.decided_at).toBeTruthy();
      expect(body.comment).toBeNull();

      const n = await db
        .select()
        .from(kpi_notifications)
        .where(and(eq(kpi_notifications.kind, "raise_approved"), eq(kpi_notifications.employee_id, A.id)));
      expect(n).toHaveLength(1);
      expect(n[0].recipient_kind).toBe("employee");
      expect(n[0].payload).toEqual({ quarter_start: Q, amount: 300000, avg_pct: 94 });
      expect(n[0].dedupe_key).toStartWith(`raise_approved:${row.id}:`);
    });

    it("сумма 600000 — 422 bad_amount; дробная и отрицательная тоже", async () => {
      const row = await rowOf(D);
      for (const amount of [600000, -1, 1.5, "100"]) {
        const r = await decide(row.id, { status: "approved", amount, comment: "причина" });
        expect(r.status).toBe(422);
        expect(r.body).toEqual({ error: "bad_amount" });
      }
      expect((await rowOf(D)).status).toBe("proposed");
    });

    it("insufficient без комментария — 422; с комментарием — 200", async () => {
      const row = await rowOf(B);
      const no = await decide(row.id, { status: "approved", amount: 0 });
      expect(no.status).toBe(422);
      expect(no.body).toEqual({ error: "comment_required" });
      expect((await decide(row.id, { status: "approved", amount: 0, comment: "   " })).status).toBe(422);
      const ok = await decide(row.id, { status: "approved", amount: 0, comment: "Нет оценок за два месяца" });
      expect(ok.status).toBe(200);
      expect(ok.body.approved_amount).toBe(0);
      expect(ok.body.comment).toBe("Нет оценок за два месяца");
    });

    it("сумма не равна предложению и отказ при ненулевом предложении требуют комментарий", async () => {
      const row = await rowOf(D);
      const diff = await decide(row.id, { status: "approved", amount: 200000 });
      expect(diff.body).toEqual({ error: "comment_required" });
      const rej = await decide(row.id, { status: "rejected" });
      expect(rej.body).toEqual({ error: "comment_required" });
      expect((await decide(row.id, { status: "maybe" })).status).toBe(422);
      const rejOk = await decide(row.id, { status: "rejected", amount: 100, comment: "Не прошёл испытательный срок" });
      expect(rejOk.status).toBe(200);
      // Отказ всегда с суммой 0.
      expect(rejOk.body.status).toBe("rejected");
      expect(rejOk.body.approved_amount).toBe(0);
    });

    it("повторное решение без комментария — 422, с комментарием — history.length 1", async () => {
      const row = await rowOf(A);
      expect(((await dbRow(row.id)).history as unknown[]).length).toBe(0);
      const no = await decide(row.id, { status: "approved" });
      expect(no.status).toBe(422);
      expect(no.body).toEqual({ error: "comment_required" });
      const ok = await decide(row.id, { status: "approved", amount: 300000, comment: "Подтверждаю повторно" });
      expect(ok.status).toBe(200);
      const hist = (await dbRow(row.id)).history as { status: string; approved_amount: number; decided_by: string; decided_at: string; comment: string | null }[];
      expect(hist).toHaveLength(1);
      expect(hist[0].status).toBe("approved");
      expect(hist[0].approved_amount).toBe(300000);
      expect(hist[0].decided_by).toBe(approver.userId);
      expect(hist[0].decided_at).toBeTruthy();
      expect(hist[0].comment).toBeNull();
      // Уведомление — на каждое новое решение (другой decided_at).
      const n = await db.select().from(kpi_notifications).where(and(eq(kpi_notifications.kind, "raise_approved"), eq(kpi_notifications.employee_id, A.id)));
      expect(n.length).toBe(1);
    });

    it("пересчёт не трогает approved и rejected", async () => {
      const before = await rows();
      const r = await compute();
      expect(r.status).toBe(200);
      const after = r.body as RaiseRow[];
      expect(after).toHaveLength(3);
      const a = after.find((x) => x.employee_id === A.id)!;
      expect(a.status).toBe("approved");
      expect(a.approved_amount).toBe(300000);
      expect(a.comment).toBe("Подтверждаю повторно");
      expect(after.find((x) => x.employee_id === D.id)!.status).toBe("rejected");
      expect(after.find((x) => x.employee_id === B.id)!.status).toBe("approved");
      expect(after.map((x) => x.id).sort()).toEqual(before.map((x) => x.id).sort());
    });

    it("PUT шкалы с суммой выше потолка — 422 tier_amount_over_cap; GET по убыванию", async () => {
      const cur = await api(hr, "GET", "/api/kpi/raise-tiers");
      expect(cur.status).toBe(200);
      expect(cur.body).toEqual(DEFAULT_TIERS);
      try {
        const over = await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 90, amount: 600000 }] });
        expect(over.status).toBe(422);
        expect(over.body).toEqual({ error: "tier_amount_over_cap" });
        const dup = await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 90, amount: 1 }, { min_pct: 90, amount: 2 }] });
        expect(dup.body).toEqual({ error: "tier_pct_duplicate" });
        expect((await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 101, amount: 1 }] })).body).toEqual({ error: "tier_pct_range" });
        // Неудачные PUT шкалу не меняют.
        expect((await api(hr, "GET", "/api/kpi/raise-tiers")).body).toEqual(DEFAULT_TIERS);

        const ok = await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: [{ min_pct: 80, amount: 100000 }, { min_pct: 93, amount: 400000 }] });
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual([{ min_pct: 93, amount: 400000 }, { min_pct: 80, amount: 100000 }]);
        // Новая шкала действует на пересчёт ещё не решённых строк.
        // Месяцы уже закрыты, поэтому отправленные оценки пишем в базу напрямую.
        const fresh = await makeEmployee(db, { terminal_id: terminal });
        for (const period of MONTHS.slice(0, 2)) {
          await db.insert(kpi_reviews).values({
            period,
            employee_id: fresh.id,
            terminal_id: terminal,
            card_id: await dbCardId(),
            evaluator_user_id: evaluator.userId,
            status: "submitted",
            score_pct: "94.00",
            submitted_at: "2025-10-01T00:00:00+05:00",
          });
        }
        setNow(CLOSE_NOW);
        const row = ((await compute()).body as RaiseRow[]).find((x) => x.employee_id === fresh.id)!;
        expect(row.months_scored).toBe(2);
        expect(row.status).toBe("proposed");
        expect(row.suggested_amount).toBe(400000);

        const approverTry = await api(approver, "PUT", "/api/kpi/raise-tiers", { tiers: [] });
        expect(approverTry.status).toBe(403);
      } finally {
        const back = await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers: DEFAULT_TIERS });
        expect(back.body).toEqual(DEFAULT_TIERS);
      }
    });

    it("CSV: заголовок и строка сотрудника", async () => {
      const res = await callApi(`/api/kpi/raises/export?quarter=${Q}`, { headers: { ...approver.headers } });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="kpi-raises-2025-Q3.csv"');
      const text = await res.text();
      expect(text.startsWith("﻿")).toBe(true);
      const lines = text.slice(1).split("\r\n");
      expect(lines[0]).toBe("ФИО;Филиал;Карта;Месяц 1;Месяц 2;Месяц 3;Средняя;Предложение;Решение;Сумма;Комментарий");
      const a = await rowOf(A);
      const line = lines.find((l) => l.startsWith(a.employee_name + ";"))!;
      expect(line).toBe(`${a.employee_name};;Тест повышение;92,00;96,00;94,00;94,00;300000;утверждено;300000;Подтверждаю повторно`);
      const q4 = await callApi(`/api/kpi/raises/export?quarter=2025-10-01`, { headers: { ...approver.headers } });
      expect(q4.headers.get("content-disposition")).toBe('attachment; filename="kpi-raises-2025-Q4.csv"');
    });

    async function dbCardId(): Promise<string> {
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as { id: string; code: string }[];
      return cards.find((c) => c.code === "test_raise")!.id;
    }
  });
}
