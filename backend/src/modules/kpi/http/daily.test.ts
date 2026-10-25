import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/daily (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { cleanupKpi, makeEmployee, makeScope, makeUser, setNow, setup } = await import("./fixtures");
  const { kpi_notifications } = await import("backend/drizzle/schema");
  const { runDaily } = await import("../worker/daily");
  const { eq } = await import("drizzle-orm");

  describe("kpi: ежедневные напоминания и сводка", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("напоминание: раз в день, только активному оценщику с неоценёнными", async () => {
      const ev = await makeUser(db);
      const blocked = await makeUser(db, { status: "blocked" });
      const e = await makeEmployee(db, { role_code: "cook" });
      await makeScope(db, ev.id, { terminal_id: e.terminal_id });
      await makeScope(db, blocked.id, { terminal_id: e.terminal_id });
      const ids = await runDaily(db, new Date("2025-11-05T10:00:00+05:00"));
      const rows = await db.select().from(kpi_notifications).where(eq(kpi_notifications.kind, "remind_evaluate"));
      const mine = rows.filter((r) => r.user_id === ev.id);
      expect(mine.map((r) => [r.dedupe_key, r.payload])).toEqual([[`remind:${ev.id}:2025-11-05`, { period: "2025-10-01", pending: 1, deadline: "2025-11-07T18:59:59.999Z" }]]);
      expect(ids).toContain(mine[0].id);
      expect(rows.some((r) => r.user_id === blocked.id)).toBe(false);
      expect(await runDaily(db, new Date("2025-11-05T15:00:00+05:00"))).toEqual([]);
    });

    it("на следующий день после срока: сводка активному HR, напоминаний нет", async () => {
      const hr = await makeUser(db, { perms: ["kpi.approve"] });
      const hrBlocked = await makeUser(db, { perms: ["kpi.approve"], status: "blocked" });
      const ids = await runDaily(db, new Date("2025-11-08T10:00:00+05:00"));
      const [s] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `overdue:2025-10-01:${hr.id}`));
      expect(s.kind).toBe("overdue_summary");
      expect((s.payload as any).lagging).toContainEqual({ user_name: "Тест Оценщик", pending: 1 });
      expect(ids).toContain(s.id);
      const all = await db.select().from(kpi_notifications);
      expect(all.some((r) => r.dedupe_key === `overdue:2025-10-01:${hrBlocked.id}`)).toBe(false);
      expect(all.some((r) => r.dedupe_key.startsWith("remind:") && r.dedupe_key.endsWith(":2025-11-08"))).toBe(false);
    });
  });
}
