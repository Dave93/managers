import type Redis from "ioredis";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "@backend/lib/db";
import {
  credentials,
  product_links_meta,
  store_product_links,
} from "backend/drizzle/schema";

// Branch → ordered-products reference synced from exord by
// cron/product_links_sync.ts, keyed by iiko store uuid (corporation_store.id).
// Read path: Redis → Postgres on miss → refill Redis. The sync job calls
// invalidateProductLinksCache() after each swap.
export const PRODUCT_LINKS_TTL_SECONDS = 15 * 60;

const keyPrefix = () => `${process.env.PROJECT_PREFIX}product_links:`;

export const storeLinksKey = (storeId: string) => `${keyPrefix()}store:${storeId}`;
export const terminalLinksKey = (terminalId: string) =>
  `${keyPrefix()}terminal:${terminalId}`;

async function cached<T>(
  redis: Redis,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await load();
  // null is cached too, so unknown ids don't hit Postgres on every request
  await redis.set(key, JSON.stringify(value), "EX", PRODUCT_LINKS_TTL_SECONDS);
  return value;
}

// Product ids ordered by a warehouse, or null when exord has no entry for it.
export function getStoreProductIds(
  redis: Redis,
  db: DrizzleDB,
  storeId: string
): Promise<string[] | null> {
  return cached(redis, storeLinksKey(storeId), async () => {
    const [row] = await db
      .select({ product_ids: store_product_links.product_ids })
      .from(store_product_links)
      .where(eq(store_product_links.store_id, storeId))
      .limit(1);
    return row ? row.product_ids : null;
  });
}

// iiko store uuids linked to a managers terminal via
// credentials(model='terminals', type='iiko_store_id').
export async function getTerminalStoreIds(
  db: DrizzleDB,
  terminalIds: string[]
): Promise<string[]> {
  if (!terminalIds.length) return [];
  const rows = await db
    .select({ key: credentials.key })
    .from(credentials)
    .where(
      and(
        eq(credentials.model, "terminals"),
        eq(credentials.type, "iiko_store_id"),
        inArray(credentials.model_id, terminalIds)
      )
    );
  return [...new Set(rows.map((r) => r.key.toLowerCase()))];
}

// Products for a terminal: union over its linked warehouses. null when the
// terminal has no warehouse link or none of them is known to exord.
export function getTerminalProducts(
  redis: Redis,
  db: DrizzleDB,
  terminalId: string
): Promise<{ store_ids: string[]; product_ids: string[] } | null> {
  return cached(redis, terminalLinksKey(terminalId), async () => {
    const storeIds = await getTerminalStoreIds(db, [terminalId]);
    if (!storeIds.length) return null;
    const rows = await db
      .select({
        store_id: store_product_links.store_id,
        product_ids: store_product_links.product_ids,
      })
      .from(store_product_links)
      .where(inArray(store_product_links.store_id, storeIds));
    if (!rows.length) return null;
    const product_ids = [...new Set(rows.flatMap((r) => r.product_ids))].sort();
    return { store_ids: rows.map((r) => r.store_id), product_ids };
  });
}

export async function getProductLinksMeta(db: DrizzleDB) {
  const [row] = await db.select().from(product_links_meta).limit(1);
  return row ?? null;
}

export async function invalidateProductLinksCache(redis: Redis): Promise<number> {
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${keyPrefix()}*`,
      "COUNT",
      200
    );
    cursor = next;
    if (keys.length) deleted += await redis.del(...keys);
  } while (cursor !== "0");
  return deleted;
}
