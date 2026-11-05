import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в attendance-review.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/выходные: наложение на баллы (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, makeEmployee, makeScope, makeTerminal, setNow, setup } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports, kpi_days_off } = await import("backend/drizzle/schema");
  const { attendanceByTerminal } = await import("../branch-facts");
  const { eq, sql } = await import("drizzle-orm");
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-11-01";
  const OPEN = "2025-11-25T10:00:00+05:00";

  describe("kpi: выходные не считаются прогулом в баллах", () => {
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

    type Day = { day: string; absent?: boolean; late?: number };
    // Посещаемость напрямую в таблицы: загрузка файла через HTTP в этом окружении недоступна.
    async function seedDays(employee_id: string, terminal_id: string, days: Day[]) {
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "days-off-overlay", uploaded_by: randomUUID(), mapping: {}, rows_total: days.length, rows_matched: days.length })
        .returning({ id: kpi_attendance_imports.id });
      await db.insert(kpi_attendance).values(
        days.map((d) => ({ employee_id, day: d.day, terminal_id, late_minutes: d.late ?? 0, absent: d.absent ?? false, import_id: imp.id }))
      );
    }
    async function seedOff(employee_id: string, terminal_id: string, day: string, cancelled = false) {
      await db.insert(kpi_days_off).values({
        employee_id,
        day,
        terminal_id,
        reason_code: "sick",
        given_by: randomUUID(),
        cancelled_at: cancelled ? sql`now()` : null,
      });
    }
    const cookWithEvaluator = async () => {
      const e = await makeEmployee(db, { role_code: "cook", terminal_id: (await makeTerminal(db)).id });
      const ev: Session = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      return { e, ev };
    };
    const suggestion = async (ev: Session, employee_id: string) => {
      const f = (await api(ev, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${employee_id}`)).body;
      expect(f.items[0].source).toBe("attendance");
      return f.items[0].suggestion;
    };

    it("подсказка «Приход и уход»: прогул с выходным выпадает из дней и прогулов; после отмены возвращается", async () => {
      const { e, ev } = await cookWithEvaluator();
      await seedDays(e.id, e.terminal_id, [{ day: "2025-11-03" }, { day: "2025-11-04" }, { day: "2025-11-05", absent: true }]);
      expect(await suggestion(ev, e.id)).toEqual({ score: 67, basis: "Workly: 3 дня, вовремя 2, опозданий 0, прогулов 1" });

      await seedOff(e.id, e.terminal_id, "2025-11-05");
      expect(await suggestion(ev, e.id)).toEqual({ score: 100, basis: "Workly: 2 дня, вовремя 2, опозданий 0, прогулов 0, выходных 1" });

      await db.update(kpi_days_off).set({ cancelled_at: sql`now()` }).where(eq(kpi_days_off.employee_id, e.id));
      expect(await suggestion(ev, e.id)).toEqual({ score: 67, basis: "Workly: 3 дня, вовремя 2, опозданий 0, прогулов 1" });
    });

    it("выходной на день, где Workly показывает присутствие: присутствие главнее, выходных в основании нет", async () => {
      const { e, ev } = await cookWithEvaluator();
      await seedDays(e.id, e.terminal_id, [{ day: "2025-11-03" }, { day: "2025-11-04", late: 10 }, { day: "2025-11-05" }]);
      await seedOff(e.id, e.terminal_id, "2025-11-04");
      await seedOff(e.id, e.terminal_id, "2025-11-05");
      expect(await suggestion(ev, e.id)).toEqual({ score: 67, basis: "Workly: 3 дня, вовремя 2, опозданий 1, прогулов 0" });
    });

    it("все прогульные дни закрыты выходными и других строк нет: предложения нет, а не 0 %", async () => {
      const { e, ev } = await cookWithEvaluator();
      await seedDays(e.id, e.terminal_id, [{ day: "2025-11-05", absent: true }]);
      await seedOff(e.id, e.terminal_id, "2025-11-05");
      expect(await suggestion(ev, e.id)).toBeNull();
    });

    it("«Сотрудники KPI»: прогулы без дней с выходным", async () => {
      const { e, ev } = await cookWithEvaluator();
      await seedDays(e.id, e.terminal_id, [{ day: "2025-11-03" }, { day: "2025-11-04", absent: true }, { day: "2025-11-05", absent: true }]);
      await seedOff(e.id, e.terminal_id, "2025-11-04");
      const rows = (await api(ev, "GET", `/api/kpi/people?period=${P}`)).body as { id: string; attendance: { ontime: number; late: number; absent: number } }[];
      expect(rows.find((r) => r.id === e.id)!.attendance).toEqual({ ontime: 1, late: 0, absent: 1 });
    });

    it("балл филиала: такие дни не входят ни в дни, ни в прогулы; отменённый выходной и присутствие не в счёт", async () => {
      const t = await makeTerminal(db);
      const [a, b, c, d, e] = Array.from({ length: 5 }, () => randomUUID());
      await seedDays(a, t.id, [{ day: "2025-11-03" }]); // вовремя
      await seedDays(b, t.id, [{ day: "2025-11-03", late: 10 }]); // опоздание
      await seedDays(c, t.id, [{ day: "2025-11-03", absent: true }]); // прогул, выходной активен
      await seedDays(d, t.id, [{ day: "2025-11-03", absent: true }]); // прогул, выходной отменён
      await seedDays(e, t.id, [{ day: "2025-11-03" }]); // присутствие, выходной активен
      await seedOff(c, t.id, "2025-11-03");
      await seedOff(d, t.id, "2025-11-03", true);
      await seedOff(e, t.id, "2025-11-03");
      expect((await attendanceByTerminal(db, P)).get(t.id)).toEqual({ days: 4, on_time: 2, late: 1, absent: 1 });
    });
  });
}
