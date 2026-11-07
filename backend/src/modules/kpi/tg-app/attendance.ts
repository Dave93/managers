// Экран «Моя посещаемость» мини-приложения: свои дни из kpi_attendance_effective (данные Workly) по месяцам.
// employeeId — только из сессии. Строки собираются поле за полем: import_id, terminal_id и id наружу не уходят.
import { kpi_attendance_effective } from "backend/drizzle/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { activeDaysOff } from "../days-off";
import { KpiError } from "../errors";
import { iso } from "../iso";
import { addMonths, periodOf } from "../time";
import { monthOf, neighbours } from "./attendance-rules";
import type { TgAttendance, TgAttendanceDay } from "./types";

// month — «YYYY-MM» или undefined (текущий по Ташкенту); всё прочее — 422 bad_period.
// Дни: от первого числа месяца до первого числа следующего, новыми сверху, только дни со строкой.
// Месяцы со строками сотрудника нужны переключателю: prev/next — ближайшие из них (и текущий месяц).
export async function attendanceFor(db: DbLike, employeeId: string, monthRaw: unknown, at: Date): Promise<TgAttendance> {
  const current = periodOf(at).slice(0, 7);
  const month = monthRaw === undefined ? current : monthOf(monthRaw);
  if (month === null) throw new KpiError(422, "bad_period");
  const from = `${month}-01`;

  const rows = await db
    .select({
      day: kpi_attendance_effective.day,
      check_in: kpi_attendance_effective.check_in,
      check_out: kpi_attendance_effective.check_out,
      late_minutes: kpi_attendance_effective.late_minutes,
      absent: kpi_attendance_effective.absent,
    })
    .from(kpi_attendance_effective)
    .where(and(eq(kpi_attendance_effective.employee_id, employeeId), gte(kpi_attendance_effective.day, from), lt(kpi_attendance_effective.day, addMonths(from, 1))))
    .orderBy(desc(kpi_attendance_effective.day));

  const withData = await db
    .selectDistinct({ month: sql<string>`to_char(${kpi_attendance_effective.day}, 'YYYY-MM')`.as("month") })
    .from(kpi_attendance_effective)
    .where(eq(kpi_attendance_effective.employee_id, employeeId));

  // Выходные: прогул Workly и день без строки с выходным приходят как day_off (причина не отдаётся);
  // присутствие главнее выходного. Дни по убыванию, как и без выходных.
  const off = (await activeDaysOff(db, { employeeIds: [employeeId], from, to: addMonths(from, 1) })).get(employeeId);
  const days: TgAttendanceDay[] = rows.map((r) =>
    r.absent && off?.has(r.day)
      ? { day: r.day, check_in: null, check_out: null, late_minutes: 0, absent: false, day_off: true }
      : { day: r.day, check_in: iso(r.check_in), check_out: iso(r.check_out), late_minutes: r.late_minutes, absent: r.absent, day_off: false }
  );
  if (off) {
    const have = new Set(rows.map((r) => r.day));
    for (const day of off.keys()) if (!have.has(day)) days.push({ day, check_in: null, check_out: null, late_minutes: 0, absent: false, day_off: true });
    days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  }

  return {
    month,
    ...neighbours(
      withData.map((r) => r.month),
      month,
      current
    ),
    days,
  };
}
