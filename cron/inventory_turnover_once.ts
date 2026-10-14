// Ручная загрузка ОСВ без очереди: bun --env-file=../backend/.env inventory_turnover_once.ts 2026-09-30 [storeId]
import { drizzleDb } from "@backend/lib/db";
import { withIikoClient } from "@backend/modules/inventory/reconcile/iiko-client";
import { fetchTurnover } from "@backend/modules/inventory/turnover/service";

const [period, storeId] = process.argv.slice(2);
if (!period) throw new Error("usage: inventory_turnover_once.ts <period> [storeId]");
const t0 = Date.now();
let total = 0;
const r = await withIikoClient((iiko) =>
  fetchTurnover(drizzleDb, iiko, { period, storeId: storeId ?? null }, async (p) => {
    if (p.total !== undefined) total = p.total;
    if (p.done !== undefined) process.stdout.write(`\r${p.done}/${total}`);
  })
);
console.log(`\n${r.stores} stores, failed: ${r.failed.join(", ") || "—"}, ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(0);
