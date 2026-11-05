// Выходные дни сотрудников: выдача и отмена управляющим (оценщиком мини-приложения), список выданных, форма.
// Правила дат и причины — days-off-rules.ts (без БД). Права: назначение оценщика (canEvaluate) по текущим
// филиалу и карте сотрудника, как у нарушений. Месяц KPI закрыт — выдавать и отменять за его дни нельзя.
import type { DrizzleDB } from "@backend/lib/db";
import { employees, kpi_days_off, kpi_periods, terminals } from "backend/drizzle/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { loadScopes, type Actor, type DbLike } from "./access";
import { checkReason, addDays, expandRange, MAX_AHEAD_DAYS, MAX_BACK_DAYS, MAX_RANGE_DAYS, periodOfDay, DAY_OFF_REASONS } from "./days-off-rules";
import { canEvaluate, loadDirectory } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { lockPeriodShared } from "./periods";
import { addMonths, tashkentDay, type Period } from "./time";
import type { DayOffReason, EvDayOffForm } from "./tg-app/ev-types";

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> => (db as DrizzleDB).transaction((tx) => fn(tx));

export type DayOffRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  terminal_id: string;
  terminal_name: string | null;
  day: string;
  reason_code: DayOffReason;
  reason_text: string | null;
  given_by: string;
  created_at: string;
  cancelled_at: string | null;
};

// Строки с именем сотрудника и названием филиала выдачи. Порядок: день по убыванию, затем фамилия, имя, id.
async function dayOffRows(db: DbLike, where: SQL | undefined): Promise<DayOffRow[]> {
  const rows = await db
    .select({
      id: kpi_days_off.id,
      employee_id: kpi_days_off.employee_id,
      first_name: employees.first_name,
      last_name: employees.last_name,
      terminal_id: kpi_days_off.terminal_id,
      terminal_name: terminals.name,
      day: kpi_days_off.day,
      reason_code: kpi_days_off.reason_code,
      reason_text: kpi_days_off.reason_text,
      given_by: kpi_days_off.given_by,
      created_at: kpi_days_off.created_at,
      cancelled_at: kpi_days_off.cancelled_at,
    })
    .from(kpi_days_off)
    .innerJoin(employees, eq(employees.id, kpi_days_off.employee_id))
    .leftJoin(terminals, eq(terminals.id, kpi_days_off.terminal_id))
    .where(where)
    .orderBy(desc(kpi_days_off.day), asc(employees.last_name), asc(employees.first_name), asc(kpi_days_off.id));
  return rows.map(({ first_name, last_name, ...r }) => ({
    ...r,
    employee_name: `${last_name} ${first_name}`.trim(),
    reason_code: r.reason_code as DayOffReason,
  }));
}

// Активный сотрудник в пределах назначения актора: нет — 404 not_found, чужой филиал или карта — 403 out_of_scope.
async function assignedEmployee(db: DbLike, actor: Actor, employeeId: string) {
  const [emp] = await loadDirectory(db, { employeeIds: [employeeId] });
  if (!emp) throw new KpiError(404, "not_found");
  const scopes = await loadScopes(db, actor.userId);
  if (!canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id })) throw new KpiError(403, "out_of_scope");
  return emp;
}

/**
 * Выдаёт выходные на дни from..to. Ошибки до записи: bad_id / not_found / out_of_scope (сотрудник), bad_dates,
 * bad_reason, reason_text_required. Любой день закрытого месяца — 409 period_closed, и тогда не пишется ничего.
 * День, где уже есть неотменённый выходной, пропускается (повтор запроса безопасен); их список — в skipped.
 */
export async function giveDaysOff(
  db: DbLike,
  actor: Actor,
  input: { employee_id?: unknown; from?: unknown; to?: unknown; reason_code?: unknown; reason_text?: unknown },
  at: Date
): Promise<{ created: DayOffRow[]; skipped: string[] }> {
  const id = input.employee_id;
  if (typeof id !== "string" || id === "") throw new KpiError(422, "bad_id");
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const emp = await assignedEmployee(db, actor, id);
  const days = expandRange(input.from, input.to, tashkentDay(at));
  const reason = checkReason(input.reason_code, input.reason_text);

  return inTx(db, async (tx) => {
    // Месяц под FOR SHARE до конца транзакции: закрытие месяца ждёт запись, запись не пройдёт в закрытый.
    for (const p of new Set(days.map(periodOfDay))) {
      if (await lockPeriodShared(tx, p)) throw new KpiError(409, "period_closed");
    }
    const inserted = await tx
      .insert(kpi_days_off)
      .values(days.map((day) => ({ employee_id: emp.id, day, terminal_id: emp.terminal_id, ...reason, given_by: actor.userId })))
      // Предикат совпадает с частичным уникальным индексом. У DoNothing Drizzle читает where (targetWhere он игнорирует).
      .onConflictDoNothing({ target: [kpi_days_off.employee_id, kpi_days_off.day], where: sql`cancelled_at is null` })
      .returning({ id: kpi_days_off.id, day: kpi_days_off.day });
    const made = new Set(inserted.map((r) => r.day));
    const created = inserted.length ? (await dayOffRows(tx, inArray(kpi_days_off.id, inserted.map((r) => r.id)))).reverse() : [];
    return { created, skipped: days.filter((d) => !made.has(d)) };
  });
}

// Отмена: только автор; уже отменённый — 409 already_cancelled; день закрытого месяца — 409 period_closed.
export async function cancelDayOff(db: DbLike, actor: Actor, id: string): Promise<DayOffRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  return inTx(db, async (tx) => {
    const [d] = await tx.select().from(kpi_days_off).where(eq(kpi_days_off.id, id)).for("update");
    if (!d) throw new KpiError(404, "not_found");
    if (d.given_by !== actor.userId) throw new KpiError(403, "forbidden");
    if (d.cancelled_at !== null) throw new KpiError(409, "already_cancelled");
    if (await lockPeriodShared(tx, periodOfDay(d.day))) throw new KpiError(409, "period_closed");
    await tx.update(kpi_days_off).set({ cancelled_at: sql`now()`, cancelled_by: actor.userId }).where(eq(kpi_days_off.id, id));
    return (await dayOffRows(tx, eq(kpi_days_off.id, id)))[0];
  });
}

// Выходные месяца, выданные самим актором, вместе с отменёнными; новые дни сверху.
export function listGivenDaysOff(db: DbLike, actor: Actor, period: Period): Promise<DayOffRow[]> {
  return dayOffRows(
    db,
    and(eq(kpi_days_off.given_by, actor.userId), gte(kpi_days_off.day, period), lt(kpi_days_off.day, addMonths(period, 1)))
  );
}

/**
 * Форма выдачи: сотрудник, причины, окно дат и дни, где выходной уже есть. Нижняя граница окна — позже из
 * «сегодня − 366 дней» и первого дня после последнего закрытого месяца; сервер при записи всё равно проверяет
 * каждый месяц отдельно (закрытые месяцы могли быть открыты заново).
 */
export async function dayOffForm(db: DbLike, actor: Actor, employeeId: unknown, at: Date): Promise<EvDayOffForm> {
  if (typeof employeeId !== "string" || !UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  const emp = await assignedEmployee(db, actor, employeeId);
  const today = tashkentDay(at);
  const max = addDays(today, MAX_AHEAD_DAYS);
  const back = addDays(today, -MAX_BACK_DAYS);
  const [lastClosed] = await db
    .select({ period: sql<string | null>`max(${kpi_periods.period})` })
    .from(kpi_periods)
    .where(eq(kpi_periods.status, "closed"));
  const afterClosed = lastClosed?.period ? addMonths(lastClosed.period, 1) : null;
  const min = afterClosed !== null && afterClosed > back ? afterClosed : back;
  const existing = await db
    .select({ day: kpi_days_off.day })
    .from(kpi_days_off)
    .where(and(eq(kpi_days_off.employee_id, emp.id), isNull(kpi_days_off.cancelled_at), gte(kpi_days_off.day, min), lte(kpi_days_off.day, max)))
    .orderBy(asc(kpi_days_off.day));
  return {
    employee: { id: emp.id, first_name: emp.first_name, last_name: emp.last_name, terminal_name: emp.terminal_name },
    reasons: [...DAY_OFF_REASONS],
    window: { min, max },
    max_range_days: MAX_RANGE_DAYS,
    existing: existing.map((r) => r.day),
  };
}
