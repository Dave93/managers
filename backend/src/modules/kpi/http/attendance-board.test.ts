import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в attendance.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/attendance board (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeTerminal, makeUser, setup } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports, kpi_days_off } = await import("backend/drizzle/schema");
  const { sql } = await import("drizzle-orm");

  const P = "2025-09-01";
  const board = (s: Awaited<ReturnType<typeof withSession>> | null) => api(s, "GET", `/api/kpi/attendance/board?period=${P}`);

  describe("kpi: табель посещаемости", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let tA: string;
    let tB: string;
    let a1: { id: string };
    let a2: { id: string };
    let bEmp: { id: string };
    let idle: { id: string };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      tA = (await makeTerminal(db)).id;
      tB = (await makeTerminal(db)).id;
      a1 = await makeEmployee(db, { terminal_id: tA });
      a2 = await makeEmployee(db, { terminal_id: tA });
      bEmp = await makeEmployee(db, { terminal_id: tB });
      idle = await makeEmployee(db, { terminal_id: tA });
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "board-test", uploaded_by: randomUUID(), mapping: {}, rows_total: 5, rows_matched: 5 })
        .returning({ id: kpi_attendance_imports.id });
      const row = (employee_id: string, terminal_id: string, day: string, o: Partial<typeof kpi_attendance.$inferInsert> = {}) => ({
        employee_id,
        terminal_id,
        day,
        late_minutes: 0,
        absent: false,
        import_id: imp.id,
        ...o,
      });
      await db.insert(kpi_attendance).values([
        row(a1.id, tA, "2025-09-01"),
        // 06:05 по Ташкенту = 01:05 UTC
        row(a1.id, tA, "2025-09-02", { late_minutes: 65, check_in: "2025-09-02T01:05:00+00:00", check_out: "2025-09-02T09:00:00+00:00" }),
        row(a1.id, tA, "2025-09-30", { absent: true }),
        row(a2.id, tA, "2025-09-15"),
        row(bEmp.id, tB, "2025-09-10", { absent: true }),
      ]);
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("права: без сессии — 401; evaluate без view — 403; плохой месяц — 422", async () => {
      expect((await board(null)).status).toBe(401);
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      expect((await board(ev)).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "GET", "/api/kpi/attendance/board?period=2025-09-15")).status).toBe(422);
    });

    it("дни кодируются, пустой день null, длина месяца 30; сотрудник без записей приходит с пустыми днями", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await board(hr);
      expect(r.status).toBe(200);
      expect(r.body.days_in_month).toBe(30);
      const byId = new Map<string, any>(r.body.employees.map((x: any) => [x.id, x]));
      const e = byId.get(a1.id);
      expect(e.days).toHaveLength(30);
      expect(e.days[0]).toEqual([0, 0, null, null]);
      expect(e.days[1]).toEqual([1, 65, "06:05", "14:00"]);
      expect(e.days[2]).toBeNull();
      expect(e.days[29]).toEqual([2, 0, null, null]);
      expect(byId.get(idle.id).days.every((d: unknown) => d === null)).toBe(true);
      // организация филиала приходит вместе с сотрудником
      expect(typeof e.organization_id).toBe("string");
      expect(typeof e.organization_name).toBe("string");
      expect(byId.has(bEmp.id)).toBe(true);
    });

    it("выходные: статус 3 на прогуле и пустом дне, присутствие главнее, отменённый не в счёт, причина и автор в off", async () => {
      const giver = await makeUser(db, { first_name: "Айбек" });
      const off = (e: { id: string }, terminal_id: string, day: string, o: Record<string, unknown> = {}) => ({
        employee_id: e.id, terminal_id, day, reason_code: "sick", given_by: giver.id, ...o,
      });
      await db.insert(kpi_days_off).values([
        off(a1, tA, "2025-09-30"), // день прогула
        off(a1, tA, "2025-09-05", { reason_code: "other", reason_text: "семейные дела" }), // день без записи
        off(a1, tA, "2025-09-02"), // день присутствия с опозданием: Workly главнее
        off(a2, tA, "2025-09-15", { cancelled_at: sql`now()` }), // отменён
        off(a2, tA, "2025-09-16", { cancelled_at: sql`now()` }), // отменён, дня без записи
        off(idle, tA, "2025-09-20"),
      ]);
      try {
        const hr = await withSession({ permissions: ["kpi.manage"] });
        const byId = new Map<string, any>((await board(hr)).body.employees.map((x: any) => [x.id, x]));
        const e = byId.get(a1.id);
        expect(e.days[29]).toEqual([3, 0, null, null]);
        expect(e.days[4]).toEqual([3, 0, null, null]);
        expect(e.days[1]).toEqual([1, 65, "06:05", "14:00"]);
        expect(Object.keys(e.off).sort()).toEqual(["30", "5"]);
        expect(e.off["30"]).toMatchObject({ reason_code: "sick", reason_text: null });
        expect(e.off["30"].by).toContain("Айбек");
        expect(e.off["5"]).toMatchObject({ reason_code: "other", reason_text: "семейные дела" });
        expect(byId.get(a2.id).days[14]).toEqual([0, 0, null, null]);
        expect(byId.get(a2.id).days[15]).toBeNull();
        expect(byId.get(a2.id).off).toBeUndefined();
        expect(byId.get(idle.id).days[19]).toEqual([3, 0, null, null]);
        expect(byId.get(bEmp.id).days[9]).toEqual([2, 0, null, null]); // прогул без выходного остаётся прогулом
        // Зона kpi.view: чужие филиалы и их выходные не видны.
        const mgr = await withSession({ permissions: ["kpi.view"], terminals: [tB] });
        expect((await board(mgr)).body.employees.map((x: any) => x.id)).toEqual([bEmp.id]);
      } finally {
        await db.delete(kpi_days_off);
      }
    });

    it("kpi.view видит только свои филиалы; без филиалов список пуст", async () => {
      const mgr = await withSession({ permissions: ["kpi.view"], terminals: [tB] });
      const mine = await board(mgr);
      expect(mine.status).toBe(200);
      expect(mine.body.employees.map((x: any) => x.id)).toEqual([bEmp.id]);
      const none = await withSession({ permissions: ["kpi.view"], terminals: [] });
      expect((await board(none)).body.employees).toEqual([]);
    });
  });
}
