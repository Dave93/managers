/**
 * Sync daily orders-count + revenue per source channel (miniapp/app/bitrix/
 * yandex_eats/uzum/bot/web/clickMiniapp/...) from the les_api & chopar_api
 * order DBs into managers `orders_by_source`.
 *
 * Reads source_type directly from each brand's MySQL (read-only) — no change to
 * the customer Laravel backends. Connection strings come from env:
 *   LES_DB_URL    = mysql://user:pass@localhost:3306/les_api
 *   CHOPAR_DB_URL = mysql://user:pass@localhost:3306/chopar_api
 *
 * Usage: bun run get_orders_by_source.ts --dateFrom=2026-05-01 --dateTo=2026-05-25
 * Defaults to yesterday for both.
 */

import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { drizzleDb } from "@backend/lib/db";
import { ordersBySource } from "backend/drizzle/schema";

const ORG = {
  les: "d955355b-c4db-3798-0163-14f6b09d000d",
  chopar: "664eca32-e479-4860-b1bb-56bb0cee5190",
};

function parseArguments(): { dateFrom: string; dateTo: string } {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const def = fmt(yesterday);
  let dateFrom = def, dateTo = def;
  for (const arg of Bun.argv) {
    if (arg.startsWith("--dateFrom=")) dateFrom = arg.split("=")[1];
    else if (arg.startsWith("--dateTo=")) dateTo = arg.split("=")[1];
  }
  console.log("Args:", { dateFrom, dateTo });
  return { dateFrom, dateTo };
}

type DbCfg = { host: string; user: string; password: string; database: string; port?: number };

async function syncBrand(brand: "les" | "chopar", cfg: DbCfg, dateFrom: string, dateTo: string) {
  if (!cfg.host || !cfg.database || !cfg.user) {
    console.error(`Missing DB config for ${brand} — skipping`);
    return;
  }
  const conn = await mysql.createConnection({ ...cfg, port: cfg.port ?? 3306 });
  try {
    // dateTo inclusive → query strictly before next day
    const [rows] = await conn.execute(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') d,
              COALESCE(t.terminal_id, '00000000-0000-0000-0000-000000000000') tid,
              COALESCE(NULLIF(o.source_type, ''), 'unknown') src,
              COUNT(*) cnt, COALESCE(SUM(o.order_total), 0) rev
       FROM orders o
       LEFT JOIN terminals t ON t.id = o.terminal_id
       WHERE o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d'), tid, src`,
      [`${dateFrom} 00:00:00`, dateTo]
    );

    const values = (rows as any[]).map((r) => ({
      date: typeof r.d === "string" ? r.d : new Date(r.d).toISOString().slice(0, 10),
      terminalId: String(r.tid),
      organizationId: ORG[brand],
      source: String(r.src),
      orderCount: Number(r.cnt) || 0,
      totalRevenue: String(Number(r.rev) || 0),
    }));

    console.log(`${brand}: ${values.length} (day,source) rows`);
    if (!values.length) return;

    // upsert per chunk: on conflict overwrite count/revenue with the fresh values
    const CHUNK = 500;
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      await drizzleDb
        .insert(ordersBySource)
        .values(chunk)
        .onConflictDoUpdate({
          target: [ordersBySource.date, ordersBySource.terminalId, ordersBySource.organizationId, ordersBySource.source],
          set: {
            orderCount: sql`excluded.order_count`,
            totalRevenue: sql`excluded.total_revenue`,
          },
        })
        .execute();
    }
  } finally {
    await conn.end();
  }
}

const cfgFromEnv = (prefix: string): DbCfg => ({
  host: process.env[`${prefix}_HOST`] || "localhost",
  user: process.env[`${prefix}_USER`] || "",
  password: process.env[`${prefix}_PASSWORD`] || "",
  database: process.env[`${prefix}_NAME`] || "",
  port: process.env[`${prefix}_PORT`] ? Number(process.env[`${prefix}_PORT`]) : 3306,
});

async function main() {
  const { dateFrom, dateTo } = parseArguments();
  await syncBrand("les", cfgFromEnv("LES_DB"), dateFrom, dateTo);
  await syncBrand("chopar", cfgFromEnv("CHOPAR_DB"), dateFrom, dateTo);
  console.log("orders_by_source sync done");
  process.exit(0);
}

main();
