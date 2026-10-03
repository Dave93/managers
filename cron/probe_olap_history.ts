// Read-only probe: how far back does iiko still return SESSION_WRITEOFF data,
// and does it still have SALES for the 2023 gap? Prints counts only.
const IIKO = "https://les-ailes-co-co.iiko.it/resto/api";

async function token() {
  const r = await fetch(`${IIKO}/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`);
  const t = await r.text();
  if (!t || t.length < 10) throw new Error("auth failed");
  return t;
}

async function transactions(key: string, from: string, to: string) {
  const r = await fetch(`${IIKO}/v2/reports/olap?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType: "TRANSACTIONS", buildSummary: "true", groupByRowFields: [],
      groupByColFields: ["DateTime.DateTyped","Session.Group","TransactionType","Product.Type","Product.Name","Product.Id","Product.Num","Product.MeasureUnit","Store"],
      aggregateFields: ["Amount.Out","Amount"],
      filters: {
        "DateTime.DateTyped": { filterType: "DateRange", from, to, includeLow: true, includeHigh: true },
        TransactionType: { filterType: "IncludeValues", values: ["SESSION_WRITEOFF"] },
        "Product.Type": { filterType: "IncludeValues", values: ["GOODS","PREPARED","DISH"] },
      },
    }),
  });
  if (!r.ok) return `HTTP ${r.status}`;
  const j = await r.json();
  const rows = j?.data ?? [];
  const days = new Set(rows.map((x: any) => x["DateTime.DateTyped"]?.slice(0,10)));
  return `${rows.length} rows / ${days.size} days`;
}

async function sales(key: string, from: string, to: string) {
  const r = await fetch(`${IIKO}/v2/reports/olap?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      reportType: "SALES", buildSummary: "false",
      groupByRowFields: ["UniqOrderId.Id","OpenDate.Typed"],
      aggregateFields: ["DishDiscountSumInt"],
      filters: {
        "OpenDate.Typed": { filterType: "DateRange", periodType: "CUSTOM", from, to, includeLow: true, includeHigh: true },
        OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
        DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
      },
    }),
  });
  if (!r.ok) return `HTTP ${r.status}`;
  const j = await r.json();
  const rows = j?.data ?? [];
  const days = new Set(rows.map((x: any) => x["OpenDate.Typed"]?.slice(0,10)));
  return `${rows.length} rows / ${days.size} days`;
}

const k = await token();
console.log("auth ok");
for (const [f, t] of [["2019-06-01","2019-06-03"],["2021-06-01","2021-06-03"],["2023-05-01","2023-05-03"],["2024-06-01","2024-06-03"],["2026-07-10","2026-07-12"]]) {
  console.log(`TRANSACTIONS ${f}..${t}: ${await transactions(k, f, t)}`);
}
for (const [f, t] of [["2023-05-01","2023-05-03"],["2023-03-20","2023-03-22"],["2023-07-28","2023-07-30"]]) {
  console.log(`SALES        ${f}..${t}: ${await sales(k, f, t)}`);
}
