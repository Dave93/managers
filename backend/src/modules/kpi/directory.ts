import { employees, kpi_cards, kpi_employee_cards, staff_roles, terminals, users } from "backend/drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import { has, type Actor, type DbLike, viewsTerminal } from "./access";
import { effectiveCardId, scopeCovers, type CardLite, type Scope } from "./rules";

export type DirEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  terminal_id: string;
  terminal_name: string | null;
  staff_role_code: string | null;
  staff_role_name: string | null;
  is_trainee: boolean | null;
  active: boolean;
  external_id: string | null;
  card_id: string | null;
  card_source: "override" | "role" | null;
};

// Сотрудники с действующей картой (ручное назначение или по роли). Без includeInactive — только активные.
export async function loadDirectory(
  db: DbLike,
  o: { employeeIds?: string[]; includeInactive?: boolean; terminalId?: string; search?: string } = {}
): Promise<DirEmployee[]> {
  if (o.employeeIds && o.employeeIds.length === 0) return [];
  const conds = [];
  if (!o.includeInactive) conds.push(eq(employees.active, true));
  if (o.employeeIds) conds.push(inArray(employees.id, o.employeeIds));
  if (o.terminalId) conds.push(eq(employees.terminal_id, o.terminalId));
  const rows = await db
    .select({
      id: employees.id,
      first_name: employees.first_name,
      last_name: employees.last_name,
      terminal_id: employees.terminal_id,
      terminal_name: terminals.name,
      staff_role_code: staff_roles.code,
      staff_role_name: staff_roles.name_ru,
      is_trainee: employees.is_trainee,
      active: employees.active,
      external_id: employees.external_id,
    })
    .from(employees)
    .leftJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .leftJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(conds.length ? and(...conds) : undefined);
  // Поиск в JS: ilike в базе с локалью C не сворачивает регистр кириллицы.
  const needle = o.search?.trim().toLowerCase();
  const found = needle
    ? rows.filter((r) => r.first_name.toLowerCase().includes(needle) || r.last_name.toLowerCase().includes(needle))
    : rows;
  if (found.length === 0) return [];

  const cards: CardLite[] = await db
    .select({
      id: kpi_cards.id,
      staff_role_codes: kpi_cards.staff_role_codes,
      active: kpi_cards.active,
      sort: kpi_cards.sort,
    })
    .from(kpi_cards);
  const ovRows = await db
    .select({ employee_id: kpi_employee_cards.employee_id, card_id: kpi_employee_cards.card_id })
    .from(kpi_employee_cards);
  const overrides = new Map(ovRows.map((r) => [r.employee_id, { card_id: r.card_id }]));

  return found.map((r) => {
    const eff = effectiveCardId(r, overrides.get(r.id), cards);
    return { ...r, card_id: eff.card_id, card_source: eff.source };
  });
}

type Target = { terminal_id: string; card_id: string | null };

export function canEvaluate(actor: Actor, scopes: Scope[], e: Target): boolean {
  return has(actor, "kpi.evaluate") && scopeCovers(scopes, e);
}

export function canSeeEmployee(actor: Actor, scopes: Scope[], e: Target): boolean {
  return viewsTerminal(actor, e.terminal_id) || canEvaluate(actor, scopes, e);
}

// Видимость по текущему положению сотрудника или по снимку (филиал и карта записи на момент события).
export function canSeeEither(actor: Actor, scopes: Scope[], current: Target | null, snapshot: Target | null): boolean {
  return (
    (current !== null && canSeeEmployee(actor, scopes, current)) ||
    (snapshot !== null && canSeeEmployee(actor, scopes, snapshot))
  );
}

// "Имя Фамилия" или login.
export async function userNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const rows = await db
    .select({ id: users.id, login: users.login, first_name: users.first_name, last_name: users.last_name })
    .from(users)
    .where(inArray(users.id, uniq));
  for (const r of rows) out.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(" ") || r.login);
  return out;
}

export async function terminalNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const rows = await db.select({ id: terminals.id, name: terminals.name }).from(terminals).where(inArray(terminals.id, uniq));
  for (const r of rows) out.set(r.id, r.name);
  return out;
}
