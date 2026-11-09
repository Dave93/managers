// Менеджер филиала как оценщик без учётной записи. Сотрудник с ролью «Менеджер» (staff_roles.code = manager),
// у которого к Telegram привязана запись сотрудника, оценивает всех сотрудников своего филиала по любым картам
// (кроме самого себя) и выдаёт им выходные: создавать для него пользователя с ролью не нужно. Пара того же
// человека в другой компании Workly (employee_twins, не blocked) добавляет и её филиал: управляющий общего зала
// оценивает обе стороны. Стажёр-менеджер (trainee_manager) и неактивный сотрудник сюда не попадают.
// Права и назначения вычисляются на каждом запросе: смена роли или увольнение закрывают доступ сразу.
import { employee_twins, employees, staff_roles } from "backend/drizzle/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import type { DbLike } from "./access";
import type { Scope } from "./rules";

export const MANAGER_ROLE_CODE = "manager";

export type ManagerPerson = { ids: string[]; terminals: string[] };

// Активный менеджер: его id и id его пар (он же в другой компании), филиалы всех активных строк.
export async function managerPerson(db: DbLike, employeeId: string): Promise<ManagerPerson | null> {
  const [me] = await db
    .select({ id: employees.id, terminal_id: employees.terminal_id })
    .from(employees)
    .innerJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .where(and(eq(employees.id, employeeId), eq(employees.active, true), eq(staff_roles.code, MANAGER_ROLE_CODE)));
  if (!me) return null;
  const pairs = await db
    .select({ a: employee_twins.employee_a, b: employee_twins.employee_b })
    .from(employee_twins)
    .where(and(eq(employee_twins.blocked, false), or(eq(employee_twins.employee_a, employeeId), eq(employee_twins.employee_b, employeeId))));
  const twinIds = pairs.map((p) => (p.a === employeeId ? p.b : p.a));
  const ids = [employeeId, ...twinIds];
  const rows = twinIds.length
    ? await db
        .select({ id: employees.id, terminal_id: employees.terminal_id })
        .from(employees)
        .where(and(inArray(employees.id, twinIds), eq(employees.active, true)))
    : [];
  return { ids, terminals: [...new Set([me.terminal_id, ...rows.map((r) => r.terminal_id)])] };
}

// Назначения менеджера: каждый его филиал, любая карта.
export async function managerScopes(db: DbLike, employeeIds: string[]): Promise<Scope[]> {
  if (employeeIds.length === 0) return [];
  const rows = await db
    .select({ terminal_id: employees.terminal_id })
    .from(employees)
    .where(and(inArray(employees.id, employeeIds), eq(employees.active, true)));
  return [...new Set(rows.map((r) => r.terminal_id))].map((terminal_id) => ({ card_id: null, terminal_id }));
}

// Все активные менеджеры сети с привязкой Telegram как сотрудника: для списка «автоматически» в админке.
export async function listAutoManagers(db: DbLike) {
  return db
    .select({ id: employees.id, first_name: employees.first_name, last_name: employees.last_name, terminal_id: employees.terminal_id })
    .from(employees)
    .innerJoin(staff_roles, eq(staff_roles.id, employees.staff_role_id))
    .where(and(eq(employees.active, true), eq(staff_roles.code, MANAGER_ROLE_CODE)));
}
