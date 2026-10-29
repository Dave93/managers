import type Redis from "ioredis";
import type { DrizzleDB } from "@backend/lib/db";
import { getStoreProductIds } from "@backend/modules/product_links/service";

// Товары, которые склад филиала получает по exord (spec §13): store_product_links
// по iiko store id через кэш модуля product_links (Redis → Postgres).
// null — данных нет (exord не знает склад или прислал пустой список —
// иначе получилась бы инвентаризация, где нельзя ничего посчитать): без фильтра.
export async function storeProductIds(redis: Redis, db: DrizzleDB, storeId: string): Promise<string[] | null> {
  const ids = await getStoreProductIds(redis, db, storeId);
  return ids && ids.length > 0 ? ids : null;
}
