import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в attendance.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/people (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeTerminal, setup } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports, kpi_violations } = await import("backend/drizzle/schema");

  const P = "2025-09-01";
  type S = Awaited<ReturnType<typeof withSession>>;
  const people = (s: S | null, period = P) => api(s, "GET", `/api/kpi/people?period=${period}`);
  const profile = (s: S | null, id: string, period = P) => api(s, "GET", `/api/kpi/employees/${id}/profile?period=${period}`);

  describe("kpi: список сотрудников и карточка", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let tA: string;
    let tB: string;
    let a: { id: string };
    let b: { id: string };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      tA = (await makeTerminal(db)).id;
      tB = (await makeTerminal(db)).id;
      a = await makeEmployee(db, { terminal_id: tA, role_code: "cook" });
      b = await makeEmployee(db, { terminal_id: tB, role_code: "cook" });
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "people-test", uploaded_by: randomUUID(), mapping: {}, rows_total: 4, rows_matched: 4 })
        .returning({ id: kpi_attendance_imports.id });
      const row = (day: string, o: Partial<typeof kpi_attendance.$inferInsert> = {}) => ({
        employee_id: a.id,
        terminal_id: tA,
        day,
        late_minutes: 0,
        absent: false,
        import_id: imp.id,
        ...o,
      });
      await db.insert(kpi_attendance).values([
        row("2025-09-01"),
        row("2025-09-02", { late_minutes: 20, check_in: "2025-09-02T04:20:00+00:00", check_out: "2025-09-02T13:00:00+00:00" }),
        row("2025-09-03", { absent: true }),
        row("2025-09-04", { absent: true }),
      ]);
      await db.insert(kpi_violations).values([
        { terminal_id: tA, employee_id: a.id, period: P, occurred_at: "2025-09-10T10:00:00+05:00", comment: "Грязный фартук", recorded_by: randomUUID() },
        { terminal_id: tA, employee_id: a.id, period: P, occurred_at: "2025-09-11T10:00:00+05:00", comment: "Опоздал на пересменку", recorded_by: randomUUID(), status: "cancelled", cancel_reason: "ошибка" },
      ]);
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("права: без сессии — 401; без kpi-прав — 403; плохой месяц — 422", async () => {
      expect((await people(null)).status).toBe(401);
      expect((await profile(null, a.id)).status).toBe(401);
      const nobody = await withSession({ permissions: ["kpi_layout"] });
      expect((await people(nobody)).status).toBe(403);
      expect((await profile(nobody, a.id)).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "GET", "/api/kpi/people?period=2025-09-15")).status).toBe(422);
    });

    it("список: итоги посещаемости и только действующие нарушения", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await people(hr);
      expect(r.status).toBe(200);
      const byId = new Map<string, any>(r.body.map((x: any) => [x.id, x]));
      expect(byId.get(a.id).attendance).toEqual({ ontime: 1, late: 1, absent: 2 });
      expect(byId.get(a.id).violations).toBe(1);
      expect(byId.get(b.id).attendance).toEqual({ ontime: 0, late: 0, absent: 0 });
      expect(byId.get(b.id).violations).toBe(0);
    });

    it("список: управляющий (kpi.view) видит только свои филиалы", async () => {
      const mgr = await withSession({ permissions: ["kpi.view"], terminals: [tB] });
      const r = await people(mgr);
      expect(r.status).toBe(200);
      expect(r.body.map((x: any) => x.id)).toEqual([b.id]);
    });

    it("карточка: состав ответа и итоги месяца", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await profile(hr, a.id);
      expect(r.status).toBe(200);
      expect(r.body.employee).toMatchObject({ id: a.id, has_card: true, workly_linked: false, telegram_bound: false, terminal_id: tA });
      expect(r.body.period).toBe(P);
      expect(r.body.review).toBeNull();
      expect(r.body.attendance.month).toBe("2025-09");
      expect(r.body.attendance.days.filter((d: any) => d.absent)).toHaveLength(2);
      expect(r.body.violations.items).toHaveLength(2);
      expect(Array.isArray(r.body.history.quarters)).toBe(true);
      expect(r.body.home.has_card).toBe(true);
    });

    it("карточка: чужой филиал — 403, неизвестный и кривой id — 404", async () => {
      const mgr = await withSession({ permissions: ["kpi.view"], terminals: [tB] });
      expect((await profile(mgr, a.id)).status).toBe(403);
      expect((await profile(mgr, b.id)).status).toBe(200);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await profile(hr, randomUUID())).status).toBe(404);
      expect((await profile(hr, "not-a-uuid")).status).toBe(404);
    });
  });
}
