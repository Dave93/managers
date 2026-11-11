// Связь сотрудника с кассиром iiko: по ней оценщик видит чеки и средний чек кассира (tg-app/ev-sales.ts).
// Автоматически связать нельзя: имя в iiko часто короткое («Baxrom»), а код кассира не табельный номер.
// Поэтому связь задаёт человек (kpi.manage); совпадение по имени лишь подсказка в списке.
import type { DrizzleDB } from "@backend/lib/db";
import { cash_shift_cashiers, employees } from "backend/drizzle/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { now } from "./clock";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { matchesName, searchWords } from "./name-search";
import type { DbLike } from "./access";

/** iiko пишет этот uuid, когда у чека нет кассира: это не человек. */
export const NO_CASHIER = "00000000-0000-0000-0000-000000000000";
const CANDIDATE_DAYS = 60;
const TASHKENT_MS = 5 * 3600_000;

export interface CashierCandidate {
  cashier_id: string;
  name: string;
  code: string | null;
  checks: number;
  last_day: string;
  /** Имя в iiko похоже на имя сотрудника. Подсказка: подтверждает человек. */
  suggested: boolean;
  /** Кассир уже связан с другим активным сотрудником («Фамилия Имя»); null — свободен. */
  taken_by: string | null;
}

/** Кассиры, пробившие чеки в филиале сотрудника за последние 60 дней, свежие первыми. */
export async function listCashierCandidates(db: DbLike, employeeId: string): Promise<CashierCandidate[]> {
  if (!UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  const [emp] = await db
    .select({ id: employees.id, first_name: employees.first_name, last_name: employees.last_name, terminal_id: employees.terminal_id })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);
  if (!emp) throw new KpiError(404, "not_found");

  const since = new Date(now().getTime() + TASHKENT_MS - CANDIDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const res = await db.execute(sql`
    SELECT c.cashier_id::text AS cashier_id,
           (array_agg(c.cashier_name ORDER BY s.business_date DESC))[1] AS name,
           (array_agg(c.cashier_code ORDER BY s.business_date DESC))[1] AS code,
           sum(c.orders_count)::int AS checks,
           max(s.business_date)::text AS last_day
    FROM cash_shift_cashiers c
    JOIN cash_shifts s ON s.id = c.shift_id
    WHERE s.terminal_id = ${emp.terminal_id}::uuid
      AND s.business_date >= ${since}::date
      AND c.cashier_id <> ${NO_CASHIER}::uuid
    GROUP BY c.cashier_id
    ORDER BY max(s.business_date) DESC, sum(c.orders_count) DESC`);
  const rows = res.rows as { cashier_id: string; name: string; code: string | null; checks: number; last_day: string }[];
  if (rows.length === 0) return [];

  const holders = await db
    .select({ cashier: employees.iiko_cashier_id, first_name: employees.first_name, last_name: employees.last_name })
    .from(employees)
    .where(and(eq(employees.active, true), ne(employees.id, employeeId), inArray(employees.iiko_cashier_id, rows.map((r) => r.cashier_id))));
  const takenBy = new Map(holders.map((h) => [h.cashier, `${h.last_name} ${h.first_name}`.trim()]));

  return rows.map((r) => ({
    cashier_id: r.cashier_id,
    name: r.name,
    code: r.code,
    checks: Number(r.checks),
    last_day: r.last_day,
    suggested: matchesName(searchWords(r.name), emp),
    taken_by: takenBy.get(r.cashier_id) ?? null,
  }));
}

// null снимает связь. Один кассир — один активный сотрудник (проверка и запись под одним advisory-локом,
// как у табельного номера). Кассир должен существовать в выгрузке iiko: опечатку в uuid не принимаем.
export async function setCashier(
  db: DrizzleDB,
  employeeId: string,
  raw: unknown
): Promise<{ id: string; cashier_id: string | null }> {
  if (!UUID_RE.test(employeeId)) throw new KpiError(404, "not_found");
  if (raw !== null && (typeof raw !== "string" || !UUID_RE.test(raw) || raw === NO_CASHIER)) throw new KpiError(422, "bad_cashier");
  const value = raw === null ? null : raw.toLowerCase();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kpi_iiko_cashier'))`);
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!emp) throw new KpiError(404, "not_found");
    if (value !== null) {
      const [known] = await tx.select({ id: cash_shift_cashiers.cashier_id }).from(cash_shift_cashiers).where(eq(cash_shift_cashiers.cashier_id, value)).limit(1);
      if (!known) throw new KpiError(422, "unknown_cashier");
      const [dup] = await tx
        .select({ id: employees.id, first_name: employees.first_name, last_name: employees.last_name })
        .from(employees)
        .where(and(ne(employees.id, employeeId), eq(employees.active, true), eq(employees.iiko_cashier_id, value)))
        .limit(1);
      if (dup) throw new KpiError(409, "cashier_taken", { employee_id: dup.id, employee_name: `${dup.last_name} ${dup.first_name}`.trim() });
    }
    await tx.update(employees).set({ iiko_cashier_id: value, updated_at: now().toISOString() }).where(eq(employees.id, employeeId));
    return { id: employeeId, cashier_id: value };
  });
}
