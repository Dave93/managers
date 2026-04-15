/**
 * Backfill report_olap table with DISH data from iiko.
 *
 * Usage:
 *   bun run cron/backfill_olap.ts --from 2024-01-01 --to 2024-12-31
 *
 * Fetches data day-by-day with a delay between requests to avoid rate limits.
 */

import { drizzleDb } from "@backend/lib/db";
import { report_olap } from "backend/drizzle/schema";
import { and, gte, lte } from "drizzle-orm";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { chunk } from "cron/src/chunk";

dayjs.extend(utc);
dayjs.extend(timezone);

const IIKO_BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const DELAY_BETWEEN_DAYS_MS = 5000;

function parseArgs() {
  const args = process.argv.slice(2);
  let from = "";
  let to = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) from = args[i + 1];
    if (args[i] === "--to" && args[i + 1]) to = args[i + 1];
  }

  if (!from || !to) {
    console.error("Usage: bun run cron/backfill_olap.ts --from YYYY-MM-DD --to YYYY-MM-DD");
    process.exit(1);
  }

  const fromDate = dayjs(from);
  const toDate = dayjs(to);

  if (!fromDate.isValid() || !toDate.isValid()) {
    console.error("Invalid date format. Use YYYY-MM-DD.");
    process.exit(1);
  }

  if (toDate.isBefore(fromDate)) {
    console.error("--to must be after --from");
    process.exit(1);
  }

  return { fromDate, toDate };
}

async function getToken(): Promise<string> {
  const res = await fetch(
    `${IIKO_BASE}/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`
  );
  const token = await res.text();
  if (!token || token.length < 10) {
    throw new Error("Failed to get iiko token: " + token);
  }
  return token;
}

async function fetchOlapForRange(token: string, fromDate: string, toDate: string) {
  const body = {
    reportType: "TRANSACTIONS",
    buildSummary: "true",
    groupByRowFields: [],
    groupByColFields: [
      "DateTime.DateTyped",
      "Session.Group",
      "TransactionType",
      "Product.Type",
      "Product.Name",
      "Product.Id",
      "Product.Num",
      "Product.MeasureUnit",
      "Store",
    ],
    aggregateFields: ["Amount.Out"],
    filters: {
      "DateTime.DateTyped": {
        filterType: "DateRange",
        from: fromDate,
        to: toDate,
        includeLow: true,
        includeHigh: true,
      },
      TransactionType: {
        filterType: "IncludeValues",
        values: ["SESSION_WRITEOFF"],
      },
      "Product.Type": {
        filterType: "IncludeValues",
        values: ["GOODS", "PREPARED", "DISH"],
      },
    },
  };

  console.log(`[API] Requesting ${fromDate} to ${toDate}...`);

  const res = await fetch(`${IIKO_BASE}/v2/reports/olap?key=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`iiko API error ${res.status}: ${text.substring(0, 300)}`);
  }

  return res.json();
}

async function processRange(token: string, from: dayjs.Dayjs, to: dayjs.Dayjs): Promise<number> {
  const fromStr = from.format("YYYY-MM-DD");
  const toStr = to.format("YYYY-MM-DD");

  const reportOlap = await fetchOlapForRange(token, fromStr, toStr);

  // Debug: log response structure on first call
  if (!(processRange as any)._logged) {
    (processRange as any)._logged = true;
    const keys = Object.keys(reportOlap);
    console.log(`[DEBUG] Response keys: ${JSON.stringify(keys)}`);
    const rows = reportOlap.data ?? [];
    console.log(`[DEBUG] data length: ${rows.length}`);
    if (rows.length > 0) {
      console.log(`[DEBUG] First item keys: ${JSON.stringify(Object.keys(rows[0]))}`);
      console.log(`[DEBUG] First item: ${JSON.stringify(rows[0])}`);
    }
  }

  const rows = reportOlap.data ?? [];
  console.log(`[${fromStr} → ${toStr}] Got ${rows.length} records`);

  if (rows.length === 0) return 0;

  // Delete existing records for this range
  await drizzleDb
    .delete(report_olap)
    .where(
      and(
        gte(report_olap.dateTime, new Date(fromStr).toISOString()),
        lte(report_olap.dateTime, new Date(toStr + "T23:59:59").toISOString())
      )
    )
    .execute();

  // Insert new records
  const insertItems = rows.map((row: any) => ({
    id: row.id,
    dateTime: row["DateTime.DateTyped"],
    productId: row["Product.Id"],
    productName: row["Product.Name"],
    productType: row["Product.Type"],
    sessionGroup: row["Session.Group"],
    transactionType: row["TransactionType"],
    amauntOut: row["Amount.Out"],
    productNum: row["Product.Num"],
    productUnit: row["Product.MeasureUnit"],
    store: row["Store"],
  }));

  const chunks = chunk(insertItems, 1000);
  for (const batch of chunks) {
    await drizzleDb.insert(report_olap).values(batch).execute();
  }

  console.log(`[${fromStr} → ${toStr}] Inserted ${rows.length} records`);
  return rows.length;
}

const CHUNK_DAYS = 7; // Process 7 days at a time

async function main() {
  const { fromDate, toDate } = parseArgs();
  const totalDays = toDate.diff(fromDate, "day") + 1;

  console.log(`=== Backfill report_olap ===`);
  console.log(`Period: ${fromDate.format("YYYY-MM-DD")} to ${toDate.format("YYYY-MM-DD")} (${totalDays} days)`);
  console.log(`Chunk size: ${CHUNK_DAYS} days, delay between chunks: ${DELAY_BETWEEN_DAYS_MS / 1000}s`);
  console.log(`Product types: GOODS, PREPARED, DISH\n`);

  let token = await getToken();
  console.log("Token obtained\n");

  let totalInserted = 0;
  let chunkNum = 0;

  for (let chunkStart = fromDate; !chunkStart.isAfter(toDate); chunkStart = chunkStart.add(CHUNK_DAYS, "day")) {
    let chunkEnd = chunkStart.add(CHUNK_DAYS - 1, "day");
    if (chunkEnd.isAfter(toDate)) chunkEnd = toDate;

    chunkNum++;

    // Refresh token every 10 chunks
    if (chunkNum > 1 && chunkNum % 10 === 0) {
      console.log("\nRefreshing token...");
      token = await getToken();
      console.log("New token obtained\n");
    }

    try {
      const inserted = await processRange(token, chunkStart, chunkEnd);
      totalInserted += inserted;
    } catch (e: any) {
      console.error(`\nERROR for ${chunkStart.format("YYYY-MM-DD")} → ${chunkEnd.format("YYYY-MM-DD")}:`, e.message);
      // Try with fresh token
      try {
        console.log("Retrying with fresh token...");
        token = await getToken();
        const inserted = await processRange(token, chunkStart, chunkEnd);
        totalInserted += inserted;
      } catch (retryErr: any) {
        console.error(`Retry failed: ${retryErr.message}`);
      }
    }

    if (!chunkEnd.isSame(toDate)) {
      const daysProcessed = chunkEnd.diff(fromDate, "day") + 1;
      console.log(`Progress: ${daysProcessed}/${totalDays} days. Total inserted: ${totalInserted}. Waiting ${DELAY_BETWEEN_DAYS_MS / 1000}s...\n`);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_DAYS_MS));
    }
  }

  console.log(`\n=== Done! Total inserted: ${totalInserted} records over ${totalDays} days ===`);
  process.exit(0);
}

main();
