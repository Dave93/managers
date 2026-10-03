/**
 * Sync per-dish sales cost from iiko SALES OLAP into managers.dish_cost_daily.
 *
 * Usage (from /home/davr/managers/cron, env from ./.env):
 *   ./dish_cost_sync                                   # last 4 closed days (Tashkent)
 *   ./dish_cost_sync --from 2026-07-01 --to 2026-09-28
 *
 * One SALES request per day covers every branch. Cost is iiko's own
 * ProductCostBase.ProductCost (line total). It is only as good as the stock
 * prices behind it: branches that never book incoming invoices show ~0 cost,
 * so consumers must check coverage before trusting a margin.
 *
 * The table is a plain table (order_items is a compressed hypertable, so a new
 * column there would mean rewriting compressed chunks). A day is replaced whole,
 * in one transaction, and an empty OLAP answer never wipes existing rows.
 */
import { drizzleDb } from "@backend/lib/db";
import { sql } from "drizzle-orm";
import { IikoResto } from "./src/modules/cash_shifts/iiko";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const tashkentToday = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function parseArgs(argv: string[]): { from: string; to: string } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const today = tashkentToday();
  const from = get("--from") ?? addDays(today, -4);
  const to = get("--to") ?? addDays(today, -1);
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) throw new Error(`bad --from/--to: ${from} ${to}`);
  return { from, to };
}

async function ensureTable() {
  await drizzleDb.execute(sql`
    CREATE TABLE IF NOT EXISTS dish_cost_daily (
      day date NOT NULL,
      restaurant_group_id uuid NOT NULL,
      dish_name text NOT NULL,
      dish_type text NOT NULL,
      qty numeric NOT NULL DEFAULT 0,
      revenue numeric NOT NULL DEFAULT 0,
      cost numeric NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (day, restaurant_group_id, dish_name, dish_type)
    )`);
  await drizzleDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_dish_cost_daily_group_day ON dish_cost_daily (restaurant_group_id, day)`);
}

type Agg = { qty: number; revenue: number; cost: number };

async function fetchDay(iiko: IikoResto, day: string): Promise<Map<string, Agg & { g: string; name: string; type: string }>> {
  const res = await iiko.request("POST", "/v2/reports/olap", {}, {
    reportType: "SALES",
    buildSummary: "false",
    groupByRowFields: ["RestorauntGroup.Id", "DishName", "DishType", "Storned"],
    aggregateFields: ["DishAmountInt", "DishDiscountSumInt", "ProductCostBase.ProductCost"],
    filters: {
      "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from: day, to: day, includeLow: true, includeHigh: true },
      OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
      DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
    },
  });
  const json: any = await res.json();
  const out = new Map<string, Agg & { g: string; name: string; type: string }>();
  for (const r of json?.data ?? []) {
    if (r.Storned === true || r.Storned === "true") continue;
    const g = r["RestorauntGroup.Id"];
    const name = r.DishName;
    const type = r.DishType;
    if (!g || !name || !type) continue;
    const key = `${g}|${name}|${type}`;
    const cur = out.get(key) ?? { g, name, type, qty: 0, revenue: 0, cost: 0 };
    cur.qty += Number(r.DishAmountInt) || 0;
    cur.revenue += Number(r.DishDiscountSumInt) || 0;
    cur.cost += Number(r["ProductCostBase.ProductCost"]) || 0;
    out.set(key, cur);
  }
  return out;
}

async function main() {
  const { from, to } = parseArgs(process.argv.slice(2));
  await ensureTable();
  const iiko = new IikoResto();
  let ok = 0;
  const failed: string[] = [];
  try {
    for (let day = from; day <= to; day = addDays(day, 1)) {
      try {
        const rows = await fetchDay(iiko, day);
        if (rows.size === 0) {
          console.warn(`[dish_cost] ${day}: OLAP returned nothing, kept existing rows`);
          continue;
        }
        const list = [...rows.values()];
        await drizzleDb.transaction(async (tx) => {
          await tx.execute(sql`DELETE FROM dish_cost_daily WHERE day = ${day}::date`);
          for (let i = 0; i < list.length; i += 1000) {
            const part = list.slice(i, i + 1000);
            const values = sql.join(
              part.map((r) => sql`(${day}::date, ${r.g}::uuid, ${r.name}, ${r.type}, ${r.qty}, ${r.revenue}, ${r.cost})`),
              sql`, `
            );
            await tx.execute(sql`
              INSERT INTO dish_cost_daily (day, restaurant_group_id, dish_name, dish_type, qty, revenue, cost)
              VALUES ${values}`);
          }
        });
        ok++;
        console.log(`[dish_cost] ${day}: ${list.length} rows`);
      } catch (e) {
        failed.push(day);
        console.error(`[dish_cost] ${day} FAILED: ${(e as Error).message}`);
      }
      await Bun.sleep(3000);
    }
  } finally {
    await iiko.logout();
  }
  console.log(`[dish_cost] done ${from}..${to}: ${ok} days ok, ${failed.length} failed${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("[dish_cost] fatal:", e);
  process.exit(1);
});
