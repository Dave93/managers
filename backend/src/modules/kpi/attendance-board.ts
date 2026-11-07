import { employees, kpi_attendance_effective, organization, staff_roles, terminals } from "backend/drizzle/schema";
import { and, between, eq, inArray } from "drizzle-orm";
import { seesNetwork, type Actor, type DbLike } from "./access";
import { activeDaysOff, type DayOffInfo } from "./days-off";
import { userNames } from "./directory";
import { addMonths, daysInMonth, type Period } from "./time";
import type { AttendanceBoard, BoardDay, BoardEmployee } from "./types";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// HH:MM по Ташкенту из метки времени; null, если отметки нет
export function clockOf(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : clock.format(d);
}

export function boardDay(r: { absent: boolean; late_minutes: number; check_in: string | null; check_out: string | null }): BoardDay {
  if (r.absent) return [2, 0, null, null];
  return [r.late_minutes > 0 ? 1 : 0, r.late_minutes, clockOf(r.check_in), clockOf(r.check_out)];
}

// Табель месяца по сотрудникам, которых актор вправе видеть: вся сеть у HR и согласующих, иначе свои филиалы
// (правило viewsTerminal, как у экранов «Сеть» и «Филиал»; список «Оценки» дополнительно показывает назначенных оценщику).
// В список входят все активные сотрудники зоны (без записей у них все дни пусты: Workly их не знает или не прислал)
// и неактивные, у которых за месяц есть записи.
export async function loadAttendanceBoard(db: DbLike, actor: Actor, q: { period: Period }): Promise<AttendanceBoard> {
  const days = daysInMonth(q.period);
  const lastDay = `${q.period.slice(0, 8)}${String(days).padStart(2, "0")}`;
  const zone = seesNetwork(actor) ? null : actor.terminals;
  if (zone && zone.length === 0) return { period: q.period, days_in_month: days, employees: [] };
  const inZone = zone ? inArray(employees.terminal_id, zone) : undefined;

  const person = {
    id: employees.id,
    first_name: employees.first_name,
    last_name: employees.last_name,
    terminal_id: employees.terminal_id,
    terminal_name: terminals.name,
    organization_id: terminals.organization_id,
    organization_name: organization.name,
    active: employees.active,
    role: staff_roles.name_ru,
    position: employees.position,
  };
  const rows = await db
    .select({
      ...person,
      day: kpi_attendance_effective.day,
      absent: kpi_attendance_effective.absent,
      late_minutes: kpi_attendance_effective.late_minutes,
      check_in: kpi_attendance_effective.check_in,
      check_out: kpi_attendance_effective.check_out,
    })
    .from(kpi_attendance_effective)
    .innerJoin(employees, eq(employees.id, kpi_attendance_effective.employee_id))
    .leftJoin(terminals, eq(terminals.id, employees.terminal_id))
    .leftJoin(organization, eq(organization.id, terminals.organization_id))
    .leftJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .where(and(between(kpi_attendance_effective.day, q.period, lastDay), inZone));
  const active = await db
    .select(person)
    .from(employees)
    .leftJoin(terminals, eq(terminals.id, employees.terminal_id))
    .leftJoin(organization, eq(organization.id, terminals.organization_id))
    .leftJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .where(and(eq(employees.active, true), inZone));

  const byId = new Map<string, BoardEmployee>();
  const add = (r: (typeof active)[number]): BoardEmployee => {
    let e = byId.get(r.id);
    if (!e) {
      e = {
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        role: r.role ?? r.position,
        terminal_id: r.terminal_id,
        terminal_name: r.terminal_name,
        organization_id: r.organization_id,
        organization_name: r.organization_name,
        active: r.active,
        days: Array.from({ length: days }, () => null),
      };
      byId.set(r.id, e);
    }
    return e;
  };
  for (const r of rows) add(r).days[Number(r.day.slice(8, 10)) - 1] = boardDay(r);
  for (const r of active) add(r);

  // Выходные накладываются на пустые дни и прогулы; присутствие (вовремя, опоздание) главнее выходного.
  const offs = await activeDaysOff(db, { employeeIds: [...byId.keys()], from: q.period, to: addMonths(q.period, 1) });
  const shown: { e: BoardEmployee; index: number; info: DayOffInfo }[] = [];
  for (const [id, byDay] of offs) {
    const e = byId.get(id)!;
    for (const [day, info] of byDay) {
      const index = Number(day.slice(8, 10)) - 1;
      const cur = e.days[index];
      if (cur === null || cur[0] === 2) shown.push({ e, index, info });
    }
  }
  const givers = await userNames(db, shown.map((x) => x.info.given_by));
  for (const { e, index, info } of shown) {
    e.days[index] = [3, 0, null, null];
    (e.off ??= {})[String(index + 1)] = { reason_code: info.reason_code, reason_text: info.reason_text, by: givers.get(info.given_by) ?? null };
  }

  const ru = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "ru");
  const list = [...byId.values()].sort(
    (a, b) => ru(a.terminal_name, b.terminal_name) || ru(a.last_name, b.last_name) || ru(a.first_name, b.first_name) || a.id.localeCompare(b.id)
  );
  return { period: q.period, days_in_month: days, employees: list };
}
