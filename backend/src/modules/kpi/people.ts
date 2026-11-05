import { employees, kpi_attendance, kpi_tg_bindings, kpi_violations, organization, terminals } from "backend/drizzle/schema";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { has, loadScopes, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { absentDayOff } from "./days-off";
import { canSeeEmployee, loadDirectory } from "./directory";
import { listEmployeeRows, UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { loadSettings } from "./settings";
import { attendanceFor } from "./tg-app/attendance";
import { employeeHome, historyFor } from "./tg-app/home";
import { reviewFor, violationsOf } from "./tg-app/review";
import { addMonths, currentReviewPeriod, type Period } from "./time";
import type { EmployeeCard, PeopleRow } from "./types";

// Список «Сотрудники KPI»: те, кого актор видит в «Оценках», с итогами посещаемости и нарушений за месяц.
// HR (kpi.manage) видит и сотрудников без карты: им нужно знать, кого не оценивают.
export async function loadPeople(db: DbLike, actor: Actor, period: Period): Promise<PeopleRow[]> {
  const rows = await listEmployeeRows(db, actor, { period }, { includeUncarded: has(actor, "kpi.manage") });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const next = addMonths(period, 1);

  const att = await db
    .select({
      employee_id: kpi_attendance.employee_id,
      ontime: sql<number>`count(*) filter (where not ${kpi_attendance.absent} and ${kpi_attendance.late_minutes} = 0)::int`,
      late: sql<number>`count(*) filter (where not ${kpi_attendance.absent} and ${kpi_attendance.late_minutes} > 0)::int`,
      // Прогул с выходным в этот день не считается: см. absentDayOff.
      absent: sql<number>`count(*) filter (where ${kpi_attendance.absent} and not ${absentDayOff(kpi_attendance)})::int`,
    })
    .from(kpi_attendance)
    .where(and(inArray(kpi_attendance.employee_id, ids), gte(kpi_attendance.day, period), lt(kpi_attendance.day, next)))
    .groupBy(kpi_attendance.employee_id);
  const attBy = new Map(att.map((a) => [a.employee_id, { ontime: Number(a.ontime), late: Number(a.late), absent: Number(a.absent) }]));

  const vio = await db
    .select({ employee_id: kpi_violations.employee_id, n: sql<number>`count(*)::int` })
    .from(kpi_violations)
    .where(and(inArray(kpi_violations.employee_id, ids), eq(kpi_violations.period, period), eq(kpi_violations.status, "active")))
    .groupBy(kpi_violations.employee_id);
  const vioBy = new Map(vio.map((v) => [v.employee_id, Number(v.n)]));

  return rows.map((r) => ({
    ...r,
    attendance: attBy.get(r.id) ?? { ontime: 0, late: 0, absent: 0 },
    violations: vioBy.get(r.id) ?? 0,
  }));
}

// Карточка сотрудника за месяц. Видимость как у списка: viewsTerminal или назначение оценщика.
export async function loadEmployeeCard(db: DbLike, actor: Actor, employeeId: string, periodRaw: Period): Promise<EmployeeCard> {
  if (!UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  const [dir] = await loadDirectory(db, { employeeIds: [employeeId], includeInactive: true });
  if (!dir) throw new KpiError(404, "not_found");
  const scopes = await loadScopes(db, actor.userId);
  if (!canSeeEmployee(actor, scopes, { terminal_id: dir.terminal_id, card_id: dir.card_id })) throw new KpiError(403, "forbidden");

  const at = now();
  const s = await loadSettings(db);
  const R = currentReviewPeriod(at, s.review_deadline_day);

  const [meta] = await db
    .select({
      position: employees.position,
      workly_id: employees.workly_id,
      workly_tab: employees.workly_tab_number,
      external_id: employees.external_id,
      organization_name: organization.name,
    })
    .from(employees)
    .leftJoin(terminals, eq(terminals.id, employees.terminal_id))
    .leftJoin(organization, eq(organization.id, terminals.organization_id))
    .where(eq(employees.id, employeeId));
  const [bound] = await db
    .select({ id: kpi_tg_bindings.id })
    .from(kpi_tg_bindings)
    .where(and(eq(kpi_tg_bindings.employee_id, employeeId), eq(kpi_tg_bindings.active, true)))
    .limit(1);

  const home = await employeeHome(db, employeeId, s, R, at);
  // Нет отправленной оценки за месяц — не ошибка: карточка показывает «оценки нет».
  const review = await reviewFor(db, employeeId, periodRaw, at).catch((e) => {
    if (e instanceof KpiError && e.status === 404) return null;
    throw e;
  });
  return {
    employee: {
      id: dir.id,
      first_name: dir.first_name,
      last_name: dir.last_name,
      position: home.position_ru ?? meta?.position ?? null,
      terminal_id: dir.terminal_id,
      terminal_name: dir.terminal_name,
      organization_name: meta?.organization_name ?? null,
      tab_number: meta?.workly_tab ?? meta?.external_id ?? null,
      active: dir.active,
      has_card: dir.card_id !== null,
      workly_linked: meta?.workly_id != null,
      telegram_bound: Boolean(bound),
    },
    period: periodRaw,
    home,
    review,
    violations: await violationsOf(db, employeeId, periodRaw, at),
    attendance: await attendanceFor(db, employeeId, periodRaw.slice(0, 7), at),
    history: await historyFor(db, employeeId, at),
  };
}
