/**
 * Разовая сверка без очереди — для проверки на локальной базе и ручных прогонов.
 *   bun inventory_reconcile_once.ts 2026-08-31            # все склады
 *   bun inventory_reconcile_once.ts 2026-08-31 <storeId>  # один склад
 * iiko — только чтение. Пишет в базу из DATABASE_URL.
 */
import { drizzleDb } from "@backend/lib/db";
import { processReconcileJob } from "@backend/modules/inventory/reconcile/job";
import { statusKey } from "@backend/modules/inventory/reconcile/queue";
import { isValidPeriod } from "@backend/modules/inventory/rules";
import client from "./src/redis";

const [period, storeId] = process.argv.slice(2);
if (!period || !isValidPeriod(period)) {
  console.error("usage: bun inventory_reconcile_once.ts YYYY-MM-DD(last day) [storeId]");
  process.exit(1);
}
const key = statusKey(period);
await processReconcileJob(drizzleDb, client, { period, storeId: storeId ?? null, userId: null, statusKey: key });
console.log(await client.get(key));
process.exit(0);
