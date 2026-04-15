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

async function fetchOlapForDay(token: string, date: string) {
  const res = await fetch(`${IIKO_BASE}/v2/reports/olap?key=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
          from: date,
          to: date,
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
    }),
  });

  if (!res.ok) {
    throw new Error(`iiko API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function processDay(token: string, date: dayjs.Dayjs): Promise<void> {
  const dateStr = date.format("YYYY-MM-DD");
  console.log(`\n[${dateStr}] Fetching from iiko...`);

  const reportOlap = await fetchOlapForDay(token, dateStr);

  // Debug: log response structure on first call
  if (!(processDay as any)._logged) {
    (processDay as any)._logged = true;
    const keys = Object.keys(reportOlap);
    console.log(`[DEBUG] Response keys: ${JSON.stringify(keys)}`);
    if (Array.isArray(reportOlap)) {
      console.log(`[DEBUG] Response is array, length: ${reportOlap.length}`);
      if (reportOlap.length > 0) console.log(`[DEBUG] First item keys: ${JSON.stringify(Object.keys(reportOlap[0]))}`);
    } else if (reportOlap.data) {
      console.log(`[DEBUG] reportOlap.data length: ${reportOlap.data.length}`);
      if (reportOlap.data.length > 0) console.log(`[DEBUG] First item: ${JSON.stringify(reportOlap.data[0])}`);
    } else {
      console.log(`[DEBUG] Full response (first 500 chars): ${JSON.stringify(reportOlap).substring(0, 500)}`);
    }
  }

  const rows = Array.isArray(reportOlap) ? reportOlap : (reportOlap.data ?? []);
  const count = rows.length;
  console.log(`[${dateStr}] Got ${count} records`);

  if (count === 0) return;

  // Delete existing records for this day
  const dayStart = date.startOf("day").toISOString();
  const dayEnd = date.endOf("day").toISOString();

  await drizzleDb
    .delete(report_olap)
    .where(and(gte(report_olap.dateTime, dayStart), lte(report_olap.dateTime, dayEnd)))
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

  console.log(`[${dateStr}] Inserted ${count} records`);
}

async function main() {
  const { fromDate, toDate } = parseArgs();
  const totalDays = toDate.diff(fromDate, "day") + 1;

  console.log(`=== Backfill report_olap ===`);
  console.log(`Period: ${fromDate.format("YYYY-MM-DD")} to ${toDate.format("YYYY-MM-DD")} (${totalDays} days)`);
  console.log(`Delay between days: ${DELAY_BETWEEN_DAYS_MS / 1000}s`);
  console.log(`Product types: GOODS, PREPARED, DISH\n`);

  const token = await getToken();
  console.log("Token obtained");

  let processed = 0;
  for (let d = fromDate; !d.isAfter(toDate); d = d.add(1, "day")) {
    try {
      await processDay(token, d);
    } catch (e) {
      console.error(`[${d.format("YYYY-MM-DD")}] ERROR:`, e);
      // Try to get a new token in case it expired
      if (processed > 0 && processed % 30 === 0) {
        console.log("Refreshing token...");
        try {
          const newToken = await getToken();
          console.log("New token obtained");
          // Retry with new token
          await processDay(newToken, d);
        } catch (retryErr) {
          console.error(`[${d.format("YYYY-MM-DD")}] Retry failed:`, retryErr);
        }
      }
    }

    processed++;
    const remaining = totalDays - processed;
    if (remaining > 0) {
      console.log(`Progress: ${processed}/${totalDays} days (${remaining} remaining). Waiting ${DELAY_BETWEEN_DAYS_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_DAYS_MS));
    }
  }

  console.log(`\n=== Done! Processed ${processed}/${totalDays} days ===`);
  process.exit(0);
}

main();
