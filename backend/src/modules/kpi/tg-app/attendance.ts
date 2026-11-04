// Экран «Моя посещаемость» мини-приложения: свои дни из kpi_attendance (данные Workly) по месяцам.
// employeeId — только из сессии. Строки собираются поле за полем: import_id, terminal_id и id наружу не уходят.
import { kpi_attendance } from "backend/drizzle/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { KpiError } from "../errors";
import { iso } from "../iso";
import { addMonths, periodOf } from "../time";
import { monthOf, neighbours } from "./attendance-rules";
import type { TgAttendance } from "./types";

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
      day: kpi_attendance.day,
      check_in: kpi_attendance.check_in,
      check_out: kpi_attendance.check_out,
      late_minutes: kpi_attendance.late_minutes,
      absent: kpi_attendance.absent,
    })
    .from(kpi_attendance)
    .where(and(eq(kpi_attendance.employee_id, employeeId), gte(kpi_attendance.day, from), lt(kpi_attendance.day, addMonths(from, 1))))
    .orderBy(desc(kpi_attendance.day));

  const withData = await db
    .selectDistinct({ month: sql<string>`to_char(${kpi_attendance.day}, 'YYYY-MM')`.as("month") })
    .from(kpi_attendance)
    .where(eq(kpi_attendance.employee_id, employeeId));

  return {
    month,
    ...neighbours(
      withData.map((r) => r.month),
      month,
      current
    ),
    days: rows.map((r) => ({
      day: r.day,
      check_in: iso(r.check_in),
      check_out: iso(r.check_out),
      late_minutes: r.late_minutes,
      absent: r.absent,
    })),
  };
}
