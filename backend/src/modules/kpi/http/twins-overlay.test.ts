import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в days-off-overlay.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/двойники: наложение присутствия (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeTerminal, setNow, setup } = await import("./fixtures");
  const { employee_twins, kpi_attendance, kpi_attendance_effective, kpi_attendance_imports } = await import("backend/drizzle/schema");
  const { loadPeople } = await import("../people");
  const { attendanceByTerminal } = await import("../branch-facts");
  const { attendanceStats } = await import("../attendance");
  const { attendanceFor } = await import("../tg-app/attendance");
  const { and, eq } = await import("drizzle-orm");
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-11-01";
  const OPEN = "2025-11-25T10:00:00+05:00";

  describe("kpi: присутствие в записи двойника закрывает прогул", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      setNow(OPEN);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    type Day = { day: string; absent?: boolean; late?: number; inAt?: string; outAt?: string };
    // Посещаемость напрямую в таблицы: загрузка файла через HTTP в этом окружении недоступна.
    async function seedDays(employee_id: string, terminal_id: string, days: Day[]) {
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "twins-overlay", uploaded_by: randomUUID(), mapping: {}, rows_total: days.length, rows_matched: days.length })
        .returning({ id: kpi_attendance_imports.id });
      await db.insert(kpi_attendance).values(
        days.map((d) => ({
          employee_id,
          day: d.day,
          terminal_id,
          late_minutes: d.late ?? 0,
          absent: d.absent ?? false,
          check_in: d.inAt ?? null,
          check_out: d.outAt ?? null,
          import_id: imp.id,
        }))
      );
    }
    // Два сотрудника двух организаций и пара между ними (employee_a < employee_b, как требует таблица).
    async function pair(blocked = false) {
      const a = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const b = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const [lo, hi] = a.id < b.id ? [a, b] : [b, a];
      await db.insert(employee_twins).values({ employee_a: lo.id, employee_b: hi.id, rule: "name_birth", blocked });
      return { a, b };
    }
    const eff = async (employee_id: string) =>
      (await db.select().from(kpi_attendance_effective).where(eq(kpi_attendance_effective.employee_id, employee_id))).sort((x, y) => (x.day < y.day ? -1 : 1));

    it("представление: прогул одной записи становится присутствием с отметками второй, в обе стороны; присутствие своё главнее", async () => {
      const { a, b } = await pair();
      // A: прогулы 3, 4, 5; присутствие 6. B: присутствует 3 (с опозданием и отметками), 4 нет строки, 5 прогул, 6 присутствие позже
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }, { day: "2025-11-05", absent: true }, { day: "2025-11-06", late: 0, inAt: "2025-11-06T04:00:00Z" }]);
      await seedDays(b.id, b.terminal_id, [
        { day: "2025-11-03", late: 15, inAt: "2025-11-03T04:15:00Z", outAt: "2025-11-03T13:00:00Z" },
        { day: "2025-11-05", absent: true },
        { day: "2025-11-06", late: 40, inAt: "2025-11-06T04:40:00Z" },
      ]);
      const ea = await eff(a.id);
      expect(ea.map((r) => [r.day, r.absent, r.late_minutes])).toEqual([
        ["2025-11-03", false, 15], // закрыт присутствием B, опоздание и отметки взяты у B
        ["2025-11-04", true, 0], // у B в этот день строки нет
        ["2025-11-05", true, 0], // у B тоже прогул
        ["2025-11-06", false, 0], // своё присутствие главнее
      ]);
      expect(ea[0]!.check_in).not.toBeNull();
      expect(ea[0]!.check_out).not.toBeNull();
      expect(ea[3]!.late_minutes).toBe(0);
      // Симметрично: у B прогул 5 остаётся (у A он тоже прогул), присутствия B не меняются
      const eb = await eff(b.id);
      expect(eb.map((r) => [r.day, r.absent, r.late_minutes])).toEqual([["2025-11-03", false, 15], ["2025-11-05", true, 0], ["2025-11-06", false, 40]]);
    });

    it("разорванная пара (blocked) и отсутствие пары ничего не накладывают; сама таблица kpi_attendance не меняется", async () => {
      const { a, b } = await pair(true);
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }]);
      await seedDays(b.id, b.terminal_id, [{ day: "2025-11-03" }]);
      expect((await eff(a.id)).map((r) => r.absent)).toEqual([true]);
      const single = await makeEmployee(db, { role_code: "cook" });
      await seedDays(single.id, single.terminal_id, [{ day: "2025-11-03", absent: true }]);
      expect((await eff(single.id)).map((r) => r.absent)).toEqual([true]);
      const raw = await db.select().from(kpi_attendance).where(and(eq(kpi_attendance.employee_id, a.id)));
      expect(raw.map((r) => r.absent)).toEqual([true]);
    });

    it("балл «Приход и уход» (attendanceStats) считает присутствие двойника; после разрыва пары возвращается как было", async () => {
      const { a, b } = await pair();
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }, { day: "2025-11-05" }]);
      await seedDays(b.id, b.terminal_id, [{ day: "2025-11-03" }, { day: "2025-11-04", late: 10 }]);
      const withTwin = await attendanceStats(db, a.id, P);
      expect(withTwin).toMatchObject({ days: 3, ontime: 2, late: 1, absent: 0 });
      await db.update(employee_twins).set({ blocked: true });
      const without = await attendanceStats(db, a.id, P);
      expect(without).toMatchObject({ days: 3, ontime: 1, late: 0, absent: 2 });
    });

    it("«Сотрудники KPI»: прогулы и приходы с учётом двойника", async () => {
      const { a, b } = await pair();
      const hr: Session = await withSession({ permissions: ["kpi.manage"] });
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }]);
      await seedDays(b.id, b.terminal_id, [{ day: "2025-11-03" }]);
      const rows = await loadPeople(db, { userId: hr.userId, perms: new Set(["kpi.manage"]), isHq: true, terminals: [] }, P);
      const mine = rows.find((r) => r.id === a.id)!;
      expect(mine.attendance).toEqual({ ontime: 1, late: 0, absent: 1 });
    });

    it("балл филиала (attendanceByTerminal): день, закрытый присутствием двойника, идёт в дни и вовремя, а не в прогулы", async () => {
      const t = await makeTerminal(db);
      const a = await makeEmployee(db, { role_code: "cook", terminal_id: t.id });
      const other = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const [lo, hi] = a.id < other.id ? [a, other] : [other, a];
      await db.insert(employee_twins).values({ employee_a: lo.id, employee_b: hi.id, rule: "name_birth", blocked: false });
      await seedDays(a.id, t.id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }, { day: "2025-11-05" }]);
      await seedDays(other.id, other.terminal_id, [{ day: "2025-11-03" }, { day: "2025-11-04", late: 12 }]);
      // 3-е закрыто вовремя, 4-е закрыто с опозданием, 5-е своё вовремя: трое дней, прогулов нет
      expect((await attendanceByTerminal(db, P)).get(t.id)).toEqual({ days: 3, on_time: 2, late: 1, absent: 0 });
    });

    it("«Моя посещаемость» (мини-приложение): прогул закрыт присутствием двойника с его отметками", async () => {
      const { a, b } = await pair();
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }]);
      await seedDays(b.id, b.terminal_id, [{ day: "2025-11-03", late: 5, inAt: "2025-11-03T04:05:00Z" }]);
      const my = await attendanceFor(db, a.id, "2025-11", new Date(OPEN));
      expect(my.days.map((d) => [d.day, d.absent, d.late_minutes])).toEqual([["2025-11-04", true, 0], ["2025-11-03", false, 5]]);
      expect(my.days[1]!.check_in).not.toBeNull();
    });

    it("«Моя посещаемость» и табель отдают присутствие двойника", async () => {
      const { a, b } = await pair();
      await seedDays(a.id, a.terminal_id, [{ day: "2025-11-03", absent: true }, { day: "2025-11-04", absent: true }]);
      await seedDays(b.id, b.terminal_id, [{ day: "2025-11-03", late: 5, inAt: "2025-11-03T04:05:00Z" }]);
      const hr: Session = await withSession({ permissions: ["kpi.manage"] });
      const board = await api(hr, "GET", `/api/kpi/attendance/board?period=${P}`);
      expect(board.status).toBe(200);
      const row = (board.body.employees as { id: string; days: unknown[] }[]).find((e) => e.id === a.id)!;
      // [статус, опоздание, приход, уход]: 3 ноября присутствие с опозданием (статус 1), 4 ноября прогул (статус 2)
      expect((row.days[2] as number[])[0]).toBe(1);
      expect((row.days[2] as number[])[1]).toBe(5);
      expect((row.days[3] as number[])[0]).toBe(2);
    });
  });
}
