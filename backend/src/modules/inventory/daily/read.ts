import { corporation_store, inventory_counts, store_product_links } from "backend/drizzle/schema";
import { and, between, eq, ne, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { InventoryError } from "../errors";
import { isValidPeriod } from "../rules";
import { buildDailyGrid } from "./pure";
import type { DailyGrid } from "./types";

/** Таблица «склад × день» за месяц: все склады с признаком exord (отбор — в buildDailyGrid) и пересчёты месяца. */
export async function loadDailyGrid(db: DbLike, period: string, now: Date): Promise<DailyGrid> {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  const stores = await db
    .select({
      id: corporation_store.id,
      name: corporation_store.name,
      exord: sql<boolean>`coalesce(cardinality(${store_product_links.product_ids}), 0) > 0`,
    })
    .from(corporation_store)
    .leftJoin(store_product_links, eq(store_product_links.store_id, corporation_store.id));
  const counts = await db
    .select({
      id: inventory_counts.id,
      store_id: inventory_counts.store_id,
      kind: inventory_counts.kind,
      count_date: inventory_counts.count_date,
      status: inventory_counts.status,
    })
    .from(inventory_counts)
    .where(and(between(inventory_counts.count_date, `${period.slice(0, 8)}01`, period), ne(inventory_counts.status, "cancelled")));
  return buildDailyGrid({ period, now, stores, counts });
}
