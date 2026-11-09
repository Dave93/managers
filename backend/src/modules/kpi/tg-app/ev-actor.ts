// Оценщик мини-приложения как Actor админки. Всё остальное (формы, черновики, отправка, нарушения, споры)
// считают те же сервисы, что и админка, поэтому проверки назначений и месяца не копируются.
import { users } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import type { Actor, DbLike } from "../access";
import { KpiError } from "../errors";
import { managerPerson } from "../manager-evaluator";
import type { KpiTgPrincipal } from "./ctx";

// То, что нужно от cacheController: права роли по её id (как у админки).
export type PermLookup = { getPermissionsByRoleId(roleId: string): Promise<string[]> };

// Менеджер филиала без учётной записи оценивает как оценщик: Actor с id сотрудника вместо id пользователя
// (manager-evaluator.ts). null — сотрудник не активный менеджер.
export async function managerActorOf(db: DbLike, employeeId: string | null): Promise<Actor | null> {
  if (employeeId === null) return null;
  const person = await managerPerson(db, employeeId);
  if (!person) return null;
  return { userId: employeeId, perms: new Set(["kpi.evaluate"]), isHq: false, terminals: [], managerEmployeeIds: person.ids };
}

// Права читаются на каждом запросе: в сессии их нет, поэтому снятое право или заблокированный
// пользователь закрывают доступ со следующего запроса. Из прав остаётся только kpi.evaluate:
// у управляющего или HR, чья роль несёт ещё kpi.approve, kpi.view или kpi.manage, приложение
// показывает ровно его назначения, а не всю сеть (isHq и terminals пусты по той же причине).
// Менеджер филиала, привязанный как сотрудник, оценивает и без пользователя; если пользователь тоже есть,
// назначения складываются (managerEmployeeIds у актора пользователя).
export async function evaluatorActor(db: DbLike, perms: PermLookup, p: KpiTgPrincipal): Promise<Actor> {
  const manager = await managerActorOf(db, p.employee_id);
  let fail: KpiError | null = null;
  if (p.user_id === null) fail = new KpiError(403, "not_evaluator");
  else {
    const [u] = await db
      .select({ role_id: users.role_id, status: users.status })
      .from(users)
      .where(eq(users.id, p.user_id))
      .limit(1);
    if (!u || u.status !== "active") fail = new KpiError(403, "not_evaluator");
    else {
      const granted = u.role_id ? await perms.getPermissionsByRoleId(u.role_id) : [];
      if (!granted.includes("kpi.evaluate")) fail = new KpiError(403, "forbidden");
      else return { userId: p.user_id, perms: new Set(["kpi.evaluate"]), isHq: false, terminals: [], managerEmployeeIds: manager?.managerEmployeeIds };
    }
  }
  if (manager) return manager;
  throw fail;
}
