import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в reviews.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/branch-config (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { cleanupKpi, setup } = await import("./fixtures");
  const { seedCards } = await import("../seed-cards");
  const { kpi_branch_indicators } = await import("backend/drizzle/schema");
  const { asc, eq } = await import("drizzle-orm");

  describe("kpi: настройки балла филиала", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    });
    afterAll(async () => {
      await cleanupKpi(db);
    });

    it("seedCards заводит пять показателей и не трогает правки HR", async () => {
      const rows = await db.select().from(kpi_branch_indicators).orderBy(asc(kpi_branch_indicators.sort));
      expect(rows.map((r) => [r.code, r.weight, Number(r.floor), Number(r.target), Number(r.max), r.direction])).toEqual([
        ["sales", 30, 90, 100, 115, "higher_better"], ["food_cost", 20, 1, 0.5, 0.2, "lower_better"],
        ["service", 20, 80, 92, 97, "higher_better"], ["sanitary", 15, 80, 95, 100, "higher_better"],
        ["discipline", 15, 85, 95, 99, "higher_better"],
      ]);
      await db.update(kpi_branch_indicators).set({ weight: 25 }).where(eq(kpi_branch_indicators.code, "sales"));
      expect((await seedCards(db)).indicators).toBe(0);
      const [s] = await db.select().from(kpi_branch_indicators).where(eq(kpi_branch_indicators.code, "sales"));
      expect(s.weight).toBe(25);
      await cleanupKpi(db);
      const [back] = await db.select().from(kpi_branch_indicators).where(eq(kpi_branch_indicators.code, "sales"));
      expect(back.weight).toBe(30);
    });
  });
}
