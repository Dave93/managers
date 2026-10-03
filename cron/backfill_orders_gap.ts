/**
 * Backfill orders / orders_by_time / order_items for a date range.
 *
 *   bun run backfill_orders_gap.ts 2023-03-20 2023-07-30
 *
 * Calls the same loaders the nightly dashboards_sync uses, but drives the dates
 * itself and never touches cron/date.json, so the daily cursor stays put.
 * Both loaders insert with onConflictDoNothing, so re-running is harmless.
 */
import dayjs from "dayjs";
import { main as getOrders } from "./src/modules/olap/getOrders";
import { main as getOrderItems } from "./src/modules/olap/getOrderItems";
import db, { closeConnection } from "./src/modules/olap/dbconnection";

const from = process.argv[2];
const to = process.argv[3];
if (!from || !to) {
  console.error("Usage: bun run backfill_orders_gap.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
  process.exit(1);
}

const DELAY_MS = 3000;
let ok = 0, failed: string[] = [];

for (let d = dayjs(from); !d.isAfter(dayjs(to), "day"); d = d.add(1, "day")) {
  const day = d.format("YYYY-MM-DD");
  const t0 = Date.now();
  try {
    await Promise.all([getOrders(day, db), getOrderItems(day, db)]);
    ok++;
    console.log(`[${day}] ok (${Date.now() - t0}ms)  ${ok} done`);
  } catch (e: any) {
    failed.push(day);
    console.error(`[${day}] FAILED: ${e?.message ?? e}`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`\n=== done: ${ok} days ok, ${failed.length} failed ===`);
if (failed.length) console.log("failed days:", failed.join(", "));
await closeConnection();
process.exit(0);
