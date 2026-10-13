// Чистая логика сверки (spec 2026-10-06, §3, §5): разбор ответов iiko, выбор
// документа, расчёт строк и итогов. Без БД и сети — всё покрыто pure.test.ts.
import { lastDayOfMonth } from "../rules";
import type { ReconTotals } from "./types";

export const EPS = 0.00005;
export const round4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0; // + 0 убирает -0
export const round2 = (x: number) => Math.round(x * 100) / 100 + 0;

// ── storeOperations ──

export type StoreOpRow = {
  document_id: string;
  num: string | null;
  comment: string | null;
  store_id: string;
  /** YYYY-MM-DD */
  date: string;
  type: string;
  sum: number;
};

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(body: string, name: string): string | null {
  const m = body.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? decodeXml(m[1]) : null;
}

/** XML отчёта GET reports/storeOperations → строки. */
export function parseStoreOperations(xml: string): StoreOpRow[] {
  const out: StoreOpRow[] = [];
  for (const m of xml.matchAll(/<storeReportItemDto>([\s\S]*?)<\/storeReportItemDto>/g)) {
    const b = m[1];
    const date = tag(b, "date"); // dd.MM.yyyy
    const id = tag(b, "documentId");
    const store = tag(b, "primaryStore");
    if (!date || !id || !store) continue;
    const [dd, mm, yyyy] = date.split(".");
    out.push({
      document_id: id,
      num: tag(b, "documentNum"),
      comment: tag(b, "documentComment"),
      store_id: store,
      date: `${yyyy}-${mm}-${dd}`,
      type: tag(b, "type") ?? "",
      sum: Number(tag(b, "sum") ?? 0),
    });
  }
  return out;
}

export type IikoDoc = {
  id: string;
  num: string;
  comment: string | null;
  store_id: string;
  date: string;
  shortage_sum: number;
  surplus_sum: number;
};

/** Документы инвентаризации. STORE_COST_CORRECTION без номера — авто-корректировка себестоимости, не документ. */
export function inventoryDocs(rows: StoreOpRow[]): IikoDoc[] {
  const by = new Map<string, IikoDoc>();
  for (const r of rows) {
    if (r.type !== "INVENTORY_CORRECTION" || !r.num) continue;
    const d = by.get(r.document_id) ?? {
      id: r.document_id,
      num: r.num,
      comment: r.comment,
      store_id: r.store_id,
      date: r.date,
      shortage_sum: 0,
      surplus_sum: 0,
    };
    if (r.sum < 0) d.shortage_sum = round2(d.shortage_sum + r.sum);
    else d.surplus_sum = round2(d.surplus_sum + r.sum);
    by.set(r.document_id, d);
  }
  return [...by.values()];
}

export const isMonthly = (comment: string | null) => /месяц/i.test(comment ?? "");

export type DocChoice =
  | { kind: "chosen"; doc: IikoDoc }
  | { kind: "needs_choice"; candidates: IikoDoc[] }
  | { kind: "none" };

/** Выбор документа склада за период (spec §2, п. 5–6). */
export function pickDocument(docs: IikoDoc[], previousId: string | null): DocChoice {
  if (previousId) {
    const prev = docs.find((d) => d.id === previousId);
    if (prev) return { kind: "chosen", doc: prev };
  }
  if (!docs.length) return { kind: "none" };
  const monthly = docs.filter((d) => isMonthly(d.comment));
  if (monthly.length === 1) return { kind: "chosen", doc: monthly[0] };
  return {
    kind: "needs_choice",
    candidates: [...docs].sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true })),
  };
}

// ── OLAP TRANSACTIONS / INVENTORY_CORRECTION ──

export type Correction = {
  store_id: string;
  doc_num: string;
  /** YYYY-MM-DDTHH:mm:ss, местное время iiko */
  at: string;
  product_id: string;
  product_name: string;
  qty: number;
  sum: number;
};

export function parseOlapCorrections(data: Record<string, unknown>[]): Correction[] {
  return data
    .filter((r) => r["Account.Id"] && r["Product.Id"] && r["Document"])
    .map((r) => ({
      store_id: String(r["Account.Id"]),
      doc_num: String(r["Document"]),
      at: String(r["DateTime.Typed"] ?? "").slice(0, 19),
      product_id: String(r["Product.Id"]),
      product_name: String(r["Product.Name"] ?? ""),
      qty: Number(r["Amount"] ?? 0),
      sum: Number(r["Sum.ResignedSum"] ?? 0),
    }));
}

export type CorrLine = { product_id: string; product_name: string; qty: number; sum: number };

/** Строки документа со стороны склада (Account.Id = склад) и время документа. */
export function correctionsFor(all: Correction[], storeId: string, docNum: string): { at: string | null; lines: CorrLine[] } {
  const rows = all.filter((r) => r.store_id === storeId && r.doc_num === docNum);
  const by = new Map<string, CorrLine>();
  for (const r of rows) {
    const c = by.get(r.product_id) ?? { product_id: r.product_id, product_name: r.product_name, qty: 0, sum: 0 };
    c.qty = round4(c.qty + r.qty);
    c.sum = round2(c.sum + r.sum);
    by.set(r.product_id, c);
  }
  const at = rows.map((r) => r.at).sort().at(-1) ?? null;
  return { at, lines: [...by.values()] };
}

// ── даты ──

/** Момент учёта C: минута до документа; без документа — 23:58 последнего дня. */
export function bookAt(docAt: string | null, period: string): string {
  if (!docAt) return `${period}T23:58:00`;
  return new Date(Date.parse(`${toIikoTimestamp(docAt)}Z`) - 60_000).toISOString().slice(0, 19);
}

/** "2026-08-31 23:58:00" (postgres) → "2026-08-31T23:58:00". */
export const toIikoTimestamp = (s: string) => s.replace(" ", "T").slice(0, 19);

/** YYYY-MM-DD → dd.MM.yyyy (формат storeOperations). */
export function toIikoDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** n предыдущих периодов (последние дни месяцев), ближайший первым. */
export function previousPeriods(period: string, n: number): string[] {
  let [y, m] = period.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (m === 1) {
      y -= 1;
      m = 12;
    } else {
      m -= 1;
    }
    out.push(lastDayOfMonth(y, m));
  }
  return out;
}

// ── расчёт строк ──

export type BookRow = { product_id: string; amount: number; sum: number };

export type AdminAgg = {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  /** Сумма fact_qty по отправленным пересчётам; null — во всех «не считали». */
  qty: number | null;
  state: "counted" | "skipped";
  counts_n: number;
};

export type ProductMeta = { name: string; unit_name: string | null; group_name: string };

export type LineCalc = {
  product_id: string;
  product_name: string;
  unit_name: string | null;
  group_name: string;
  admin_state: "counted" | "skipped" | "absent";
  admin_qty: number | null;
  admin_counts_n: number;
  book_qty: number;
  book_sum: number;
  iiko_correction_qty: number;
  iiko_correction_sum: number;
  iiko_fact_qty: number | null;
  unit_cost: number | null;
  cost_source: "correction" | "balance" | null;
  diff_ab_qty: number | null;
  diff_ab_sum: number | null;
  diff_ac_sum: number | null;
};

/** Цена единицы (spec §2, п. 12). */
export function unitCost(
  corr: { qty: number; sum: number } | undefined,
  book: { amount: number; sum: number } | undefined
): { cost: number | null; source: "correction" | "balance" | null } {
  if (corr && Math.abs(corr.qty) > EPS && corr.sum !== 0) return { cost: round4(corr.sum / corr.qty), source: "correction" };
  if (book && book.amount > EPS && book.sum > 0) return { cost: round4(book.sum / book.amount), source: "balance" };
  return { cost: null, source: null };
}

/** Строки отчёта: админка ∪ ненулевой учёт ∪ ненулевая корректировка. corrections=null — документа iiko нет. */
export function buildLines(input: {
  admin: AdminAgg[];
  book: BookRow[];
  corrections: CorrLine[] | null;
  meta: Map<string, ProductMeta>;
}): LineCalc[] {
  const admin = new Map(input.admin.map((a) => [a.product_id, a]));
  const book = new Map(input.book.map((b) => [b.product_id, b]));
  const corr = new Map((input.corrections ?? []).map((c) => [c.product_id, c]));
  const ids = new Set<string>(admin.keys());
  for (const b of input.book) if (Math.abs(b.amount) > EPS) ids.add(b.product_id);
  for (const c of input.corrections ?? []) if (Math.abs(c.qty) > EPS) ids.add(c.product_id);

  const out: LineCalc[] = [];
  for (const id of ids) {
    const a = admin.get(id);
    const b = book.get(id);
    const c = corr.get(id);
    const m = input.meta.get(id);
    const bookQty = round4(b?.amount ?? 0);
    const corrQty = round4(c?.qty ?? 0);
    const fact = input.corrections === null ? null : round4(bookQty + corrQty);
    const A = a && a.state === "counted" ? a.qty : null;
    const { cost, source } = unitCost(c, b);
    const dAB = A !== null && fact !== null ? round4(A - fact) : null;
    out.push({
      product_id: id,
      product_name: a?.product_name ?? m?.name ?? c?.product_name ?? id,
      unit_name: a?.unit_name ?? m?.unit_name ?? null,
      group_name: a?.group_name ?? m?.group_name ?? "Без группы",
      admin_state: a ? a.state : "absent",
      admin_qty: A,
      admin_counts_n: a?.counts_n ?? 0,
      book_qty: bookQty,
      book_sum: round2(b?.sum ?? 0),
      iiko_correction_qty: corrQty,
      iiko_correction_sum: round2(c?.sum ?? 0),
      iiko_fact_qty: fact,
      unit_cost: cost,
      cost_source: source,
      diff_ab_qty: dAB,
      diff_ab_sum: dAB !== null && cost !== null ? round2(dAB * cost) : null,
      diff_ac_sum: A !== null && cost !== null ? round2((A - bookQty) * cost) : null,
    });
  }
  return out.sort(
    (x, y) => x.group_name.localeCompare(y.group_name, "ru") || x.product_name.localeCompare(y.product_name, "ru")
  );
}

export type TotalsCalc = {
  lines_total: number;
  mismatch_ab_count: number;
  diff_ab_sum: number | null;
  diff_ac_sum: number | null;
  diff_bc_sum: number | null;
};

export function totals(lines: LineCalc[], hasDocument: boolean): TotalsCalc {
  const sum = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? round2(v.reduce((s, x) => s + x, 0)) : null;
  };
  return {
    lines_total: lines.length,
    mismatch_ab_count: lines.filter((l) => l.diff_ab_qty !== null && Math.abs(l.diff_ab_qty) > EPS).length,
    diff_ab_sum: sum(lines.map((l) => l.diff_ab_sum)),
    diff_ac_sum: sum(lines.map((l) => l.diff_ac_sum)),
    diff_bc_sum: hasDocument ? round2(lines.reduce((s, l) => s + l.iiko_correction_sum, 0)) : null,
  };
}

const fmt2 = (x: number | null) => (x === null ? null : x.toFixed(2));

export function totalsToDb(t: TotalsCalc): ReconTotals {
  return {
    lines_total: t.lines_total,
    mismatch_ab_count: t.mismatch_ab_count,
    diff_ab_sum: fmt2(t.diff_ab_sum),
    diff_ac_sum: fmt2(t.diff_ac_sum),
    diff_bc_sum: fmt2(t.diff_bc_sum),
  };
}

export function sameTotals(a: ReconTotals | null, b: ReconTotals): boolean {
  if (!a) return false;
  const n = (x: string | null | undefined) => (x === null || x === undefined ? null : Number(x));
  return (
    a.lines_total === b.lines_total &&
    a.mismatch_ab_count === b.mismatch_ab_count &&
    n(a.diff_ab_sum) === n(b.diff_ab_sum) &&
    n(a.diff_ac_sum) === n(b.diff_ac_sum) &&
    n(a.diff_bc_sum) === n(b.diff_bc_sum)
  );
}

// ── версии корректировок ──

export type CorrChange = { product_id: string; product_name: string; qty_before: number | null; qty_after: number | null };

export function diffCorrections(before: CorrLine[], after: CorrLine[]): CorrChange[] {
  const b = new Map(before.map((x) => [x.product_id, x]));
  const a = new Map(after.map((x) => [x.product_id, x]));
  const out: CorrChange[] = [];
  for (const id of new Set([...b.keys(), ...a.keys()])) {
    const x = b.get(id);
    const y = a.get(id);
    if (Math.abs((x?.qty ?? 0) - (y?.qty ?? 0)) <= EPS) continue;
    out.push({ product_id: id, product_name: y?.product_name ?? x?.product_name ?? id, qty_before: x ? x.qty : null, qty_after: y ? y.qty : null });
  }
  return out;
}
