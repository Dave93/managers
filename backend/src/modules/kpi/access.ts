import type { DrizzleDB } from "@backend/lib/db";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import { kpi_evaluator_scopes } from "backend/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { KpiError } from "./errors";
import { managerScopes } from "./manager-evaluator";
import type { Scope } from "./rules";
import { isPeriod, type Period } from "./time";

export type DbLike = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
// managerEmployeeIds: менеджер филиала без учётной записи (manager-evaluator.ts): его id сотрудника и id пар в другой
// компании. Тогда userId — тоже id сотрудника: им подписываются оценки, нарушения и выходные, пользователя за ним нет.
export type Actor = { userId: string; perms: Set<string>; isHq: boolean; terminals: string[]; managerEmployeeIds?: string[] };

export async function actorFrom(a: {
  user: any;
  role: any;
  terminals: string[];
  cacheController: any;
}): Promise<Actor> {
  // userAuth не отсекает запрос без сессии, user тогда null.
  if (!a.user) throw new KpiError(401, "unauthorized");
  const perms: string[] = a.role ? await a.cacheController.getPermissionsByRoleId(a.role.id) : [];
  const isHq = await resolveIsHq({ user: a.user, role: a.role, cacheController: a.cacheController });
  return { userId: a.user.id, perms: new Set(perms), isHq, terminals: a.terminals ?? [] };
}

export function has(actor: Actor, perm: string): boolean {
  return actor.perms.has(perm);
}

// Хватает любого из перечисленных прав.
export function requireAny(actor: Actor, perms: string[]): void {
  if (!perms.some((p) => actor.perms.has(p))) throw new KpiError(403, "forbidden");
}

// Вся сеть: HR и согласующие; головной офис — только вместе с kpi.view (раздел 8 спеки).
export function seesNetwork(actor: Actor): boolean {
  return has(actor, "kpi.manage") || has(actor, "kpi.approve") || (actor.isHq && has(actor, "kpi.view"));
}

export function viewsTerminal(actor: Actor, terminalId: string): boolean {
  return seesNetwork(actor) || (has(actor, "kpi.view") && actor.terminals.includes(terminalId));
}

// Назначения: строки kpi_evaluator_scopes пользователя плюс филиалы менеджера (если актор — менеджер филиала).
// Строка вместо актора — только назначения пользователя (чужой оценщик в списках и отчётах).
export async function loadScopes(db: DbLike, who: string | Actor): Promise<Scope[]> {
  const userId = typeof who === "string" ? who : who.userId;
  const rows: Scope[] = await db
    .select({ card_id: kpi_evaluator_scopes.card_id, terminal_id: kpi_evaluator_scopes.terminal_id })
    .from(kpi_evaluator_scopes)
    .where(eq(kpi_evaluator_scopes.user_id, userId));
  if (typeof who === "string" || !who.managerEmployeeIds?.length) return rows;
  return [...rows, ...(await managerScopes(db, who.managerEmployeeIds))];
}

// Назначения нескольких оценщиков одним запросом; у пользователя без назначений ключа в карте нет.
export async function loadScopesByUser(db: DbLike, userIds: string[]): Promise<Map<string, Scope[]>> {
  const out = new Map<string, Scope[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({
      user_id: kpi_evaluator_scopes.user_id,
      card_id: kpi_evaluator_scopes.card_id,
      terminal_id: kpi_evaluator_scopes.terminal_id,
    })
    .from(kpi_evaluator_scopes)
    .where(inArray(kpi_evaluator_scopes.user_id, userIds));
  for (const r of rows) {
    const scope = { card_id: r.card_id, terminal_id: r.terminal_id };
    const list = out.get(r.user_id);
    if (list) list.push(scope);
    else out.set(r.user_id, [scope]);
  }
  return out;
}

export function parsePeriod(v: unknown): Period {
  if (!isPeriod(v)) throw new KpiError(422, "bad_period");
  return v;
}
