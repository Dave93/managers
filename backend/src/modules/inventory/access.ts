import type { DrizzleDB } from "@backend/lib/db";
import { users_stores } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";

export type DbLike = DrizzleDB | Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export type Actor = { userId: string; perms: string[] };
export type StoreAccess = "write" | "read" | "none";

export async function actorFrom(
  cacheController: { getPermissionsByRoleId(roleId: string): Promise<string[]> },
  user: { id: string } | null,
  role: { id: string } | null
): Promise<Actor> {
  const perms = role ? await cacheController.getPermissionsByRoleId(role.id) : [];
  return { userId: user!.id, perms };
}

// Склад — единица доступа. Свой склад (users_stores) — запись. Офис с
// inventory.templates видит чужие склады только на чтение. Все остальные — none.
export async function storeAccess(db: DbLike, actor: Actor, storeId: string): Promise<StoreAccess> {
  const rows = await db
    .select({ id: users_stores.id })
    .from(users_stores)
    .where(and(eq(users_stores.user_id, actor.userId), eq(users_stores.corporation_store_id, storeId)))
    .limit(1);
  if (rows.length) return "write";
  if (actor.perms.includes("inventory.templates")) return "read";
  return "none";
}

export function canManage(actor: Actor, access: StoreAccess): boolean {
  return access === "write" && actor.perms.includes("inventory.manage");
}
