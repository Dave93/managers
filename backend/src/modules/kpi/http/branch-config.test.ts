import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в reviews.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/branch-config (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, setup } = await import("./fixtures");
  const { SEED_BRANCH_INDICATORS } = await import("../seed-data");
  type Session = Awaited<ReturnType<typeof withSession>>;
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
      await sweepTestRoles();
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

    const put = (s: Session, body: unknown) => api(s, "PUT", "/api/kpi/branch-indicators", body);
    const seedInput = () => SEED_BRANCH_INDICATORS.map((i) => ({ code: i.code, weight: i.weight, floor: i.floor, target: i.target, max: i.max, active: true }));

    it("чтение: только kpi.manage", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate", "kpi.view", "kpi.approve"] });
      expect((await api(ev, "GET", "/api/kpi/branch-indicators")).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await api(hr, "GET", "/api/kpi/branch-indicators");
      expect(r.status).toBe(200);
      expect(r.body.indicators.map((i: any) => [i.code, i.weight, i.floor])).toEqual([["sales", 30, 90], ["food_cost", 20, 1], ["service", 20, 80], ["sanitary", 15, 80], ["discipline", 15, 85]]);
      expect(r.body.settings).toEqual({ service_norm_hall_min: 8, service_norm_delivery_min: 12, sanitary_items: ["Чистота", "Санитария", "Форма персонала", "Хранение продуктов", "Маркировка"] });
    });

    it("запись: только kpi.manage; ошибки ввода — 422 с кодом", async () => {
      const v = await withSession({ permissions: ["kpi.view", "kpi.approve"] });
      expect((await put(v, { indicators: seedInput() })).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await put(hr, {})).body).toEqual({ error: "invalid_input" });
      expect((await put(hr, { indicators: seedInput().map((i) => (i.code === "discipline" ? { ...i, weight: 14 } : i)) })).body).toEqual({ error: "weights_sum", sum: 99 });
      expect((await put(hr, { indicators: seedInput().map((i) => (i.code === "food_cost" ? { ...i, floor: 0.5, target: 1 } : i)) })).body).toEqual({ error: "bad_thresholds", code: "food_cost" });
      expect((await put(hr, { settings: { service_norm_hall_min: 0 } })).body).toEqual({ error: "bad_value" });
      expect((await put(hr, { settings: { sanitary_items: [] } })).body).toEqual({ error: "bad_sanitary_items" });
    });

    it("запись: веса, нормативы и шаблон сохраняются; общие настройки KPI их не видят", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const ind = seedInput().map((i) => (i.code === "sanitary" ? { ...i, active: false } : i.code === "sales" ? { ...i, weight: 45 } : i));
      const r = await put(hr, { indicators: ind, settings: { service_norm_hall_min: 10, sanitary_items: [" Чистота ", "Маркировка"] } });
      expect(r.status).toBe(200);
      expect(r.body.indicators.find((i: any) => i.code === "sanitary").active).toBe(false);
      expect(r.body.settings).toEqual({ service_norm_hall_min: 10, service_norm_delivery_min: 12, sanitary_items: ["Чистота", "Маркировка"] });
      const s = await api(hr, "GET", "/api/kpi/settings");
      expect(Object.keys(s.body).sort()).toEqual(["change_comment_min", "dispute_deadline_day", "raise_cap", "raise_min_months", "reminder_days_before", "review_deadline_day", "violation_penalty_hint", "violation_photo_required"]);
      expect((await api(hr, "PUT", "/api/kpi/settings", { sanitary_items: ["x"] })).body).toEqual({ error: "unknown_setting" });
      await cleanupKpi(db); // вернуть стартовые показатели и настройки
    });
  });
}
