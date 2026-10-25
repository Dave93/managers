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
  const { kpi_notifications, kpi_periods } = await import("backend/drizzle/schema");
  const { runDaily } = await import("../worker/daily");
  const { dailyIfDue } = await import("../worker/daily-guard");
  const { stuckReporter } = await import("../worker/deliver");
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

    it("закрытый месяц: ни напоминания, ни сводки", async () => {
      await db.insert(kpi_periods).values([{ period: "2025-10-01", status: "closed" }, { period: "2025-11-01", status: "closed" }]);
      try {
        expect(await runDaily(db, new Date("2025-11-06T10:00:00+05:00"))).toEqual([]);
        expect(await runDaily(db, new Date("2025-12-08T10:00:00+05:00"))).toEqual([]);
        const all = await db.select().from(kpi_notifications);
        expect(all.some((r) => r.dedupe_key.endsWith(":2025-11-06"))).toBe(false);
        expect(all.some((r) => r.dedupe_key.startsWith("overdue:2025-11-01:"))).toBe(false);
      } finally {
        await db.delete(kpi_periods);
      }
      // месяц снова открыт: тот же день теперь даёт напоминание
      expect((await runDaily(db, new Date("2025-11-06T10:00:00+05:00"))).length).toBeGreaterThan(0);
    });

    function memRedis() {
      const store = new Map<string, string>();
      return {
        store,
        async get(k: string) { return store.get(k) ?? null; },
        async set(k: string, v: string) { store.set(k, v); return "OK"; },
      };
    }

    it("тик подметалки: до 10:00 ничего; упавший прогон повторяется, после успеха — тишина", async () => {
      const r = memRedis();
      let runs = 0;
      let fail = true;
      const run = async (at: Date) => {
        runs++;
        if (fail) throw new Error("db down");
        return runDaily(db, at);
      };
      expect(await dailyIfDue(r, "p_", new Date("2025-11-09T09:58:00+05:00"), run)).toEqual({ day: "2025-11-09", skipped: "before_hour" });
      expect(runs).toBe(0);
      await expect(dailyIfDue(r, "p_", new Date("2025-11-09T10:00:00+05:00"), run)).rejects.toThrow("db down");
      expect(r.store.size).toBe(0);
      fail = false;
      const out = await dailyIfDue(r, "p_", new Date("2025-11-09T10:02:00+05:00"), run);
      expect(out).toMatchObject({ day: "2025-11-09" });
      expect("created" in out).toBe(true);
      expect(r.store.has("p_kpi_daily:2025-11-09")).toBe(true);
      expect(await dailyIfDue(r, "p_", new Date("2025-11-09T10:04:00+05:00"), run)).toEqual({ day: "2025-11-09", skipped: "already_ran" });
      expect(runs).toBe(2);
      // позже в тот же день, но за другим числом отметка не действует
      expect(await dailyIfDue(r, "p_", new Date("2025-11-10T15:00:00+05:00"), async () => [])).toEqual({ day: "2025-11-10", created: 0 });
    });

    it("зависшие в sending: предупреждение только при смене числа", () => {
      const seen: number[] = [];
      const report = stuckReporter((n) => seen.push(n));
      for (const n of [0, 3, 3, 3, 5, 5, 0, 5]) report(n);
      expect(seen).toEqual([3, 5, 5]);
    });
  });
}
