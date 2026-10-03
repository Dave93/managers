import { exord_store_overrides, exord_stores, product_links_meta, terminals } from "backend/drizzle/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Actor, DbLike } from "./access";
import { InventoryError } from "./errors";
import { UUID_RE } from "./rules";
import type { ExordStoresResponse } from "./types";

// Страница «Сопоставление exord»: магазины из последнего ответа exord (снимок
// пишет cron/product_links_sync.ts) и ручные сопоставления «магазин → филиал».
// Ручное сопоставление важнее terminal_iiko_id из exord и применяется синком.

export async function listExordStores(db: DbLike): Promise<ExordStoresResponse> {
  const [meta] = await db.select({ synced_at: product_links_meta.synced_at }).from(product_links_meta).limit(1);
  const rows = await db
    .select({
      exord_user_id: exord_stores.exord_user_id,
      name: exord_stores.name,
      terminal_iiko_id: exord_stores.terminal_iiko_id,
      product_count: exord_stores.product_count,
      terminal_id: exord_stores.terminal_id,
      terminal_name: terminals.name,
      source: exord_stores.source,
      override_terminal_id: exord_store_overrides.terminal_id,
    })
    .from(exord_stores)
    .leftJoin(terminals, eq(terminals.id, exord_stores.terminal_id))
    .leftJoin(exord_store_overrides, eq(exord_store_overrides.exord_user_id, exord_stores.exord_user_id))
    .orderBy(asc(exord_stores.name));
  const active = await db
    .select({ id: terminals.id, name: terminals.name })
    .from(terminals)
    .where(eq(terminals.active, true))
    .orderBy(asc(terminals.name));
  return {
    synced_at: meta?.synced_at ?? null,
    stores: rows.map((r) => ({
      ...r,
      terminal_name: r.terminal_name ?? null,
      source: (r.source as "iiko" | "override" | null) ?? null,
      override_terminal_id: r.override_terminal_id ?? null,
    })),
    terminals: active,
  };
}

export async function setExordOverride(db: DbLike, actor: Actor, userId: number, terminalId: string | null) {
  if (terminalId === null) {
    await db.delete(exord_store_overrides).where(eq(exord_store_overrides.exord_user_id, userId));
    return { ok: true as const };
  }
  if (!UUID_RE.test(terminalId)) throw new InventoryError(404, "terminal_not_found");
  const [term] = await db
    .select({ id: terminals.id })
    .from(terminals)
    .where(and(eq(terminals.id, terminalId), eq(terminals.active, true)));
  if (!term) throw new InventoryError(404, "terminal_not_found");

  // Один филиал — один магазин exord: занят ручным сопоставлением другого
  // магазина или самим iiko id другого магазина.
  const [byOverride] = await db
    .select({ name: exord_stores.name, user_id: exord_store_overrides.exord_user_id })
    .from(exord_store_overrides)
    .leftJoin(exord_stores, eq(exord_stores.exord_user_id, exord_store_overrides.exord_user_id))
    .where(and(eq(exord_store_overrides.terminal_id, terminalId), ne(exord_store_overrides.exord_user_id, userId)));
  if (byOverride) throw new InventoryError(409, "terminal_taken", { by: byOverride.name ?? String(byOverride.user_id) });
  const [byIiko] = await db
    .select({ name: exord_stores.name })
    .from(exord_stores)
    .where(
      and(eq(exord_stores.terminal_id, terminalId), eq(exord_stores.source, "iiko"), ne(exord_stores.exord_user_id, userId))
    );
  if (byIiko) throw new InventoryError(409, "terminal_taken", { by: byIiko.name });

  await db
    .insert(exord_store_overrides)
    .values({ exord_user_id: userId, terminal_id: terminalId, updated_by: actor.userId })
    .onConflictDoUpdate({
      target: exord_store_overrides.exord_user_id,
      set: { terminal_id: terminalId, updated_by: actor.userId, updated_at: new Date().toISOString() },
    });
  return { ok: true as const };
}
