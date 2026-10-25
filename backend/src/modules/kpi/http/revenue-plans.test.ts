import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в reviews.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/revenue-plans (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { addOrder, api, cleanupKpi, makeTerminal, setup } = await import("./fixtures");
  const { kpi_revenue_plans } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  type RevenuePlanRow = import("../types").RevenuePlanRow;
  type RevenueSuggestRow = import("../types").RevenueSuggestRow;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2026-10-01";

  describe("kpi: план выручки", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    });
    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    const save = (s: Session | null, items: unknown[]) => api(s, "PUT", "/api/kpi/revenue-plans", { period: P, items });

    it("права: только kpi.manage", async () => {
      const v = await withSession({ permissions: ["kpi.view", "kpi.approve", "kpi.evaluate"] });
      expect((await api(v, "GET", `/api/kpi/revenue-plans?period=${P}`)).status).toBe(403);
      expect((await save(v, [])).status).toBe(403);
      expect((await api(v, "GET", `/api/kpi/revenue-plans/suggest?period=${P}&growth_pct=10`)).status).toBe(403);
    });

    it("список: активные и закрытые с планом; запись и удаление", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const a = await makeTerminal(db), b = await makeTerminal(db, { iiko_id: null });
      const c = await makeTerminal(db, { active: false }), d = await makeTerminal(db, { active: false });
      await db.insert(kpi_revenue_plans).values({ terminal_id: c.id, period: P, amount: "500000", updated_by: hr.userId });
      const list = (await api(hr, "GET", `/api/kpi/revenue-plans?period=${P}`)).body as RevenuePlanRow[];
      const ids = list.map((r) => r.terminal_id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id, c.id]));
      expect(ids).not.toContain(d.id);
      expect(list.find((r) => r.terminal_id === b.id)).toMatchObject({ amount: null, has_iiko: false });
      const r = await save(hr, [{ terminal_id: a.id, amount: 1_000_000 }, { terminal_id: b.id, amount: 2_500_000 }]);
      expect(r.status).toBe(200);
      expect(r.body.find((x: RevenuePlanRow) => x.terminal_id === a.id)).toMatchObject({ amount: 1000000, has_iiko: true });
      const del = await save(hr, [{ terminal_id: a.id, amount: null }]);
      expect(del.body.find((x: RevenuePlanRow) => x.terminal_id === a.id).amount).toBeNull();
    });

    it("два одинаковых PUT подряд и параллельно — 200, одна строка", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const a = await makeTerminal(db);
      const one = [{ terminal_id: a.id, amount: 700_000 }];
      const rs = await Promise.all([save(hr, one), save(hr, one)]);
      expect(rs.map((x) => x.status)).toEqual([200, 200]);
      await save(hr, one);
      const rows = await db.select().from(kpi_revenue_plans).where(eq(kpi_revenue_plans.terminal_id, a.id));
      expect(rows).toHaveLength(1);
    });

    it("ошибки ввода — 422 с кодом", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const a = await makeTerminal(db);
      for (const amount of [0, -5, "100", 1.5, 1e13]) {
        expect((await save(hr, [{ terminal_id: a.id, amount }])).body).toEqual({ error: "bad_amount", terminal_id: a.id });
      }
      const ghost = randomUUID();
      expect((await save(hr, [{ terminal_id: ghost, amount: 1 }])).body).toEqual({ error: "unknown_terminal", terminal_id: ghost });
      expect((await save(hr, [{ terminal_id: a.id, amount: 1 }, { terminal_id: a.id, amount: 2 }])).body).toEqual({ error: "duplicate_terminal", terminal_id: a.id });
      expect((await save(hr, Array.from({ length: 501 }, () => ({ terminal_id: a.id, amount: 1 })))).body).toEqual({ error: "too_many_items" });
      expect((await api(hr, "PUT", "/api/kpi/revenue-plans", { period: "2026-10-15", items: [] })).body).toEqual({ error: "bad_period" });
    });

    it("подсказка от прошлого года: тот же месяц, рост, округление до 1 000", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const a = await makeTerminal(db), b = await makeTerminal(db, { iiko_id: null }), e = await makeTerminal(db, { iiko_id: "not-a-uuid" });
      await addOrder(db, { iiko_id: a.iiko_id!, day: "2025-10-01", sum: 12_000_000 });
      await addOrder(db, { iiko_id: a.iiko_id!, day: "2025-10-31", sum: 345_678 });
      await addOrder(db, { iiko_id: a.iiko_id!, day: "2025-11-01", sum: 999_999 }); // другой месяц
      const r = await api(hr, "GET", `/api/kpi/revenue-plans/suggest?period=${P}&growth_pct=10`);
      expect(r.status).toBe(200);
      const row = (id: string) => r.body.find((x: RevenueSuggestRow) => x.terminal_id === id);
      expect(row(a.id)).toEqual({ terminal_id: a.id, base_period: "2025-10-01", base_revenue: 12345678, suggested: 13580000 });
      expect(row(b.id)).toMatchObject({ base_revenue: null, suggested: null });
      expect(row(e.id)).toMatchObject({ base_revenue: null, suggested: null }); // кривой ключ iiko — не 500
      for (const g of ["abc", "-60", "250"]) {
        expect((await api(hr, "GET", `/api/kpi/revenue-plans/suggest?period=${P}&growth_pct=${g}`)).body).toEqual({ error: "bad_growth" });
      }
    });
  });
}
