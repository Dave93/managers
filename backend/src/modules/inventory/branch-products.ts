import type Redis from "ioredis";
import type { DrizzleDB } from "@backend/lib/db";
import { store_terminal_links } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { getTerminalProductIds } from "@backend/modules/product_links/service";

// Товары, которые филиал склада использует по exord (spec §13):
// склад → филиал (store_terminal_links, из продаж) → terminal_product_links
// через кэш модуля product_links (Redis → Postgres). null — данных нет
// (у склада нет филиала, exord о филиале не знает или прислал пустой список —
// иначе получилась бы инвентаризация, где нельзя ничего посчитать): без фильтра.
export async function storeProductIds(redis: Redis, db: DrizzleDB, storeId: string): Promise<string[] | null> {
  const [row] = await db
    .select({ terminal_id: store_terminal_links.terminal_id })
    .from(store_terminal_links)
    .where(eq(store_terminal_links.store_id, storeId))
    .limit(1);
  if (!row) return null;
  const ids = await getTerminalProductIds(redis, db, row.terminal_id);
  return ids && ids.length > 0 ? ids : null;
}
