import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в inventory/routes.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:kpi доходит до fail-fast хелпера.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/me (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { closeTestRedis, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, setNow, setup } = await import("./fixtures");

  describe("kpi: me, настройки, период", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      // Холодный старт приложения бывает дольше минуты.
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      await closeTestRedis();
    });

    it("без сессии — 401", async () => expect((await api(null, "GET", "/api/kpi/me")).status).toBe(401));

    it("без kpi-прав — 403", async () => {
      const s = await withSession({ permissions: ["medical.list"] });
      expect((await api(s, "GET", "/api/kpi/me")).status).toBe(403);
    });

    it("оценщик видит свои права, настройки и сроки", async () => {
      setNow("2026-11-05T10:00:00+05:00");
      const s = await withSession({ permissions: ["kpi_layout", "kpi.evaluate"] });
      const r = await api(s, "GET", "/api/kpi/me");
      expect(r.status).toBe(200);
      expect(r.body.perms.sort()).toEqual(["kpi.evaluate", "kpi_layout"]);
      expect(r.body.current_period).toBe("2026-10-01");
      expect(r.body.settings.raise_cap).toBe(500000);
      expect(r.body.deadlines.review_deadline).toBe("2026-11-07T18:59:59.999Z");
    });

    it("настройки: оценщику PUT нельзя, HR можно, кривое значение — 422", async () => {
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await api(ev, "PUT", "/api/kpi/settings", { review_deadline_day: 5 })).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 29 })).body).toEqual({ error: "bad_day" });
      const ok = await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 6 });
      expect(ok.status).toBe(200);
      expect(ok.body.review_deadline_day).toBe(6);
      await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 7 }); // вернуть
      // Неизвестный ключ и связь дней проверяются на объединении с текущими настройками.
      const unknown = await api(hr, "PUT", "/api/kpi/settings", { nope: 1 });
      expect(unknown.status).toBe(422);
      expect(unknown.body).toEqual({ error: "unknown_setting" });
      const order = await api(hr, "PUT", "/api/kpi/settings", { review_deadline_day: 20 });
      expect(order.body).toEqual({ error: "dispute_before_review" });
    });

    it("кривой период — 422 bad_period", async () => {
      const hr = await withSession({ permissions: ["kpi.view"] });
      expect((await api(hr, "GET", "/api/kpi/periods/2026-10-15")).body).toEqual({ error: "bad_period" });
    });
  });
}
