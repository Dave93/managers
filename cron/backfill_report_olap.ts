import { drizzleDb } from "@backend/lib/db";
import { report_olap } from "backend/drizzle/schema";
import { and, gte, lte } from "drizzle-orm";
import { chunk } from "cron/src/chunk";

const fromDate = process.argv[2];
const toDate = process.argv[3];

if (!fromDate || !toDate) {
  console.error("Usage: bun run backfill_report_olap.ts <fromDate YYYY-MM-DD> <toDate YYYY-MM-DD>");
  process.exit(1);
}

async function main() {
  console.log(`Backfilling report_olap for ${fromDate}..${toDate}`);

  const authResponse = await fetch(
    `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`,
    { method: "GET" }
  );
  if (!authResponse.ok) {
    throw new Error(`Error fetching IIKO token: ${authResponse.status} ${authResponse.statusText}`);
  }
  const token = await authResponse.text();
  console.log("got token");

  const response = await fetch(
    `https://les-ailes-co-co.iiko.it/resto/api/v2/reports/olap?key=${token}`,
    {
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
        aggregateFields: ["Amount.Out", "Amount"],
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
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Error fetching report olap: ${response.status} ${response.statusText}`);
  }

  const reportOlap = await response.json();

  if (!Array.isArray(reportOlap?.data)) {
    throw new Error(`Unexpected report olap response shape: ${JSON.stringify(reportOlap).slice(0, 500)}`);
  }

  console.log("reportOlaps count:", reportOlap.data.length);

  const existing = await drizzleDb
    .select({ dateTime: report_olap.dateTime })
    .from(report_olap)
    .where(
      and(
        gte(report_olap.dateTime, new Date(fromDate).toISOString()),
        lte(report_olap.dateTime, new Date(toDate).toISOString())
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error(
      `report_olap already has rows in ${fromDate}..${toDate} — refusing to run backfill (would need explicit delete first).`
    );
  }

  const insertItems = [];
  for (const row of reportOlap.data) {
    const amount = row["Product.Type"] === "DISH" ? row["Amount"] : row["Amount.Out"];
    insertItems.push({
      dateTime: row["DateTime.DateTyped"],
      productId: row["Product.Id"],
      productName: row["Product.Name"],
      productType: row["Product.Type"],
      sessionGroup: row["Session.Group"],
      transactionType: row["TransactionType"],
      amauntOut: amount,
      productNum: row["Product.Num"],
      productUnit: row["Product.MeasureUnit"],
      store: row["Store"],
    });
  }

  const chunkedItems = chunk(insertItems, 1000);
  for (const items of chunkedItems) {
    await drizzleDb.insert(report_olap).values(items).execute();
  }

  console.log(`Inserted ${insertItems.length} rows for ${fromDate}..${toDate}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
