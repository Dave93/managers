// Оценщик мини-приложения как Actor админки. Всё остальное (формы, черновики, отправка, нарушения, споры)
// считают те же сервисы, что и админка, поэтому проверки назначений и месяца не копируются.
import { users } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import type { Actor, DbLike } from "../access";
import { KpiError } from "../errors";
import type { KpiTgPrincipal } from "./ctx";

// То, что нужно от cacheController: права роли по её id (как у админки).
export type PermLookup = { getPermissionsByRoleId(roleId: string): Promise<string[]> };

// Права читаются на каждом запросе: в сессии их нет, поэтому снятое право или заблокированный
// пользователь закрывают доступ со следующего запроса. Из прав остаётся только kpi.evaluate:
// у управляющего или HR, чья роль несёт ещё kpi.approve, kpi.view или kpi.manage, приложение
// показывает ровно его назначения, а не всю сеть (isHq и terminals пусты по той же причине).
export async function evaluatorActor(db: DbLike, perms: PermLookup, p: KpiTgPrincipal): Promise<Actor> {
  if (p.user_id === null) throw new KpiError(403, "not_evaluator");
  const [u] = await db
    .select({ role_id: users.role_id, status: users.status })
    .from(users)
    .where(eq(users.id, p.user_id))
    .limit(1);
  if (!u || u.status !== "active") throw new KpiError(403, "not_evaluator");
  const granted = u.role_id ? await perms.getPermissionsByRoleId(u.role_id) : [];
  if (!granted.includes("kpi.evaluate")) throw new KpiError(403, "forbidden");
  return { userId: p.user_id, perms: new Set(["kpi.evaluate"]), isHq: false, terminals: [] };
}
