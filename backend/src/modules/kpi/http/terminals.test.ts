import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:kpi доходит до fail-fast хелпера.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/terminals (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeTerminal, setup } = await import("./fixtures");

  describe("kpi: список филиалов", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let active: Awaited<ReturnType<typeof makeTerminal>>;
    let inactive: Awaited<ReturnType<typeof makeTerminal>>;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      // Филиалы с меткой «Тест Филиал …»: cleanupKpi удаляет их в afterAll.
      active = await makeTerminal(db);
      inactive = await makeTerminal(db, { active: false });
      // Холодный старт приложения бывает дольше минуты.
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("без сессии — 401", async () => expect((await api(null, "GET", "/api/kpi/terminals")).status).toBe(401));

    it("без kpi-прав — 403", async () => {
      const s = await withSession({ permissions: ["medical.list"] });
      expect((await api(s, "GET", "/api/kpi/terminals")).status).toBe(403);
    });

    it("оценщику без terminals.list — 200 и активный филиал в списке", async () => {
      const s = await withSession({ permissions: ["kpi.evaluate"] });
      const r = await api(s, "GET", "/api/kpi/terminals");
      expect(r.status).toBe(200);
      expect(r.body).toContainEqual({ id: active.id, name: active.name });
    });

    it("неактивного филиала в списке нет, в строке только id и name", async () => {
      const s = await withSession({ permissions: ["kpi.view"] });
      const r = await api(s, "GET", "/api/kpi/terminals");
      expect(r.status).toBe(200);
      const rows = r.body as { id: string; name: string }[];
      expect(rows.some((t) => t.id === inactive.id)).toBe(false);
      expect(rows.every((t) => Object.keys(t).sort().join() === "id,name")).toBe(true);
    });
  });
}
