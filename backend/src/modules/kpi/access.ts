import type { DrizzleDB } from "@backend/lib/db";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import { kpi_evaluator_scopes } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { KpiError } from "./errors";
import type { Scope } from "./rules";
import { isPeriod, type Period } from "./time";

export type DbLike = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type Actor = { userId: string; perms: Set<string>; isHq: boolean; terminals: string[] };

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

// Вся сеть: HR, согласующие и головной офис.
export function seesNetwork(actor: Actor): boolean {
  return has(actor, "kpi.manage") || has(actor, "kpi.approve") || actor.isHq;
}

export function viewsTerminal(actor: Actor, terminalId: string): boolean {
  return seesNetwork(actor) || (has(actor, "kpi.view") && actor.terminals.includes(terminalId));
}

export async function loadScopes(db: DbLike, userId: string): Promise<Scope[]> {
  const rows = await db
    .select({ card_id: kpi_evaluator_scopes.card_id, terminal_id: kpi_evaluator_scopes.terminal_id })
    .from(kpi_evaluator_scopes)
    .where(eq(kpi_evaluator_scopes.user_id, userId));
  return rows;
}

export function parsePeriod(v: unknown): Period {
  if (!isPeriod(v)) throw new KpiError(422, "bad_period");
  return v;
}
