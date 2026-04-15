/**
 * Fetch available OLAP columns from iiko API.
 *
 * Usage:
 *   bun run cron/iiko_olap_columns.ts
 *   bun run cron/iiko_olap_columns.ts --type SALES
 *
 * Report types: TRANSACTIONS (default), SALES, DELIVERIES
 */

const IIKO_BASE = "https://les-ailes-co-co.iiko.it/resto/api";

const reportType = process.argv.includes("--type")
  ? process.argv[process.argv.indexOf("--type") + 1]
  : "TRANSACTIONS";

async function main() {
  console.log(`Fetching OLAP columns for reportType=${reportType}...\n`);

  const tokenRes = await fetch(
    `${IIKO_BASE}/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`
  );
  const token = await tokenRes.text();

  const res = await fetch(
    `${IIKO_BASE}/v2/reports/olap/columns?key=${token}&reportType=${reportType}`
  );

  if (!res.ok) {
    console.error(`Error ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const columns = await res.json();
  console.log(JSON.stringify(columns, null, 2));
}

main();
