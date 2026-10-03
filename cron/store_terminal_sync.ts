/**
 * Склад iiko → филиал: выводит связь из продаж за 90 дней и сохраняет её в
 * store_terminal_links. Нужна инвентаризации, чтобы взять товары филиала из
 * exord (terminal_product_links) для склада.
 *
 * Usage (from /home/davr/managers/cron, env from ./.env):
 *   ./store_terminal_sync            # пересчитать и сохранить
 *   ./store_terminal_sync --dry-run  # только посчитать и показать
 *
 * Build: bun build --compile store_terminal_sync.ts --outfile store_terminal_sync
 * Crontab: раз в сутки ночью, один экземпляр:
 *   30 3 * * * cd /home/davr/managers/cron/ && flock -n /tmp/store_terminal_sync.lock ./store_terminal_sync >> /var/log/store_terminal_sync.log 2>&1
 *
 * Связи не удаляются: у склада без продаж за 90 дней (закрытый филиал)
 * остаётся последняя известная. Пустой результат таблицу не трогает.
 *
 * Spec: docs/superpowers/specs/2026-10-02-inventory-counts-design.md §13
 */
import { drizzleDb } from "@backend/lib/db";
import { store_terminal_links } from "backend/drizzle/schema";
import { sql } from "drizzle-orm";
import { loadTerminalByIikoId } from "./src/modules/terminals_by_iiko";
import { pickTerminalPerStore, type OrderAgg } from "./src/modules/store_terminal/pick";

const log = (msg: string) => console.log(`${new Date().toISOString()} store_terminal_sync: ${msg}`);
const DRY = process.argv.slice(2).includes("--dry-run");

async function loadOrderAggregates(): Promise<OrderAgg[]> {
  const res: any = await drizzleDb.execute(sql`
    SELECT store_id::text AS store_id,
           restaurant_group_id::text AS restaurant_group_id,
           count(*)::int AS orders,
           max(open_time) AS last_order_at
    FROM orders
    WHERE open_time >= now() - interval '90 days'
      AND store_id IS NOT NULL
      AND restaurant_group_id IS NOT NULL
    GROUP BY store_id, restaurant_group_id`);
  const rows: any[] = Array.isArray(res) ? res : res?.rows ?? [];
  return rows.map((r) => ({
    store_id: String(r.store_id),
    restaurant_group_id: String(r.restaurant_group_id),
    orders: Number(r.orders),
    last_order_at: r.last_order_at ? new Date(r.last_order_at).toISOString() : null,
  }));
}

async function main() {
  const [aggregates, terminals] = await Promise.all([loadOrderAggregates(), loadTerminalByIikoId()]);
  const { links, unmapped } = pickTerminalPerStore(aggregates, terminals);
  log(`order groups=${aggregates.length} terminals=${terminals.size} stores=${links.length} unmapped_groups=${unmapped}`);

  if (links.length === 0) throw new Error("refusing to write: no store → terminal links computed");
  if (DRY) {
    for (const l of links) log(`  ${l.store_id} → ${l.terminal_id} (${l.orders_90d} orders)`);
    log("dry-run, nothing written");
    return;
  }

  for (let i = 0; i < links.length; i += 100) {
    await drizzleDb
      .insert(store_terminal_links)
      .values(links.slice(i, i + 100))
      .onConflictDoUpdate({
        target: store_terminal_links.store_id,
        set: {
          terminal_id: sql`excluded.terminal_id`,
          orders_90d: sql`excluded.orders_90d`,
          last_order_at: sql`excluded.last_order_at`,
          updated_at: sql`now()`,
        },
      });
  }
  log(`upserted ${links.length} links`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    log(`ERROR ${(e as Error).message}`);
    process.exit(1);
  });
