import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "@backend/lib/db";
import {
  product_links_meta,
  terminal_product_links,
} from "backend/drizzle/schema";

// Branch → ordered-products reference synced from exord by
// cron/product_links_sync.ts. Read path: Redis → Postgres on miss → refill
// Redis. The sync job calls invalidateProductLinksCache() after each swap.
export const PRODUCT_LINKS_TTL_SECONDS = 15 * 60;

const keyPrefix = () => `${process.env.PROJECT_PREFIX}product_links:`;

export const productLinksKey = (terminalId: string) =>
  `${keyPrefix()}${terminalId}`;

// Product ids a terminal (managers terminals.id) orders, or null when exord
// has no entry for it. A null is cached too, so unknown terminals don't hit
// Postgres on every request.
export async function getTerminalProductIds(
  redis: Redis,
  db: DrizzleDB,
  terminalId: string
): Promise<string[] | null> {
  const key = productLinksKey(terminalId);
  const cached = await redis.get(key);
  if (cached !== null) return JSON.parse(cached) as string[] | null;

  const [row] = await db
    .select({ product_ids: terminal_product_links.product_ids })
    .from(terminal_product_links)
    .where(eq(terminal_product_links.terminal_id, terminalId))
    .limit(1);
  const value = row ? row.product_ids : null;
  await redis.set(key, JSON.stringify(value), "EX", PRODUCT_LINKS_TTL_SECONDS);
  return value;
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
