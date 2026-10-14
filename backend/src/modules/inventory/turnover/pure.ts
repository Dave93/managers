// Оборотно-сальдовая ведомость (spec 2026-10-14): границы периода, колонки, агрегация, правило месяца филиала.
// Без БД и iiko — только расчёт.
import { InventoryError } from "../errors";
import { nextDay } from "../reconcile/pure";
import { allowedPeriods, isValidPeriod } from "../rules";
import type { TurnoverColumn, TurnoverColumnKey } from "./types";

export type ColumnKey = TurnoverColumnKey;

export const COLUMN_ORDER: ColumnKey[] = [
  "start", "invoice", "sales", "transfer", "writeoff", "inventory",
  "outgoing_invoice", "returned_invoice", "transformation", "production", "cost_correction", "other", "end",
];
const ALWAYS = new Set<ColumnKey>(["start", "invoice", "sales", "transfer", "writeoff", "inventory", "end"]);
// Расход показываем положительным числом; остальные обороты — со знаком (+ приход, − расход).
const OUTFLOW = new Set<ColumnKey>(["sales", "writeoff", "outgoing_invoice", "returned_invoice"]);
const TYPE_COLUMN: Record<string, ColumnKey> = {
  INVOICE: "invoice",
  SESSION_WRITEOFF: "sales",
  TRANSFER: "transfer",
  WRITEOFF: "writeoff",
  INVENTORY_CORRECTION: "inventory",
  OUTGOING_INVOICE: "outgoing_invoice",
  RETURNED_INVOICE: "returned_invoice",
  TRANSFORMATION: "transformation",
  PRODUCTION: "production",
  STORE_COST_CORRECTION: "cost_correction",
};

export const columnOf = (txType: string): ColumnKey => TYPE_COLUMN[txType] ?? "other";
export const isOutflow = (key: ColumnKey) => OUTFLOW.has(key);

export type Cells = Partial<Record<ColumnKey, number>>;
export type TxAgg = { tx_type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number };
export type BalAgg = { start_qty: number; start_sum: number; end_qty: number; end_sum: number };
export type Agg = {
  qty: Cells;
  sum: Cells;
  transfer: { qty_in: number; qty_out: number; sum_in: number; sum_out: number };
  consistent: boolean;
};

const QTY_EPS = 0.0005;
const SUM_EPS = 1;

export function isConsistent(startQty: number, startSum: number, txs: TxAgg[], endQty: number, endSum: number): boolean {
  let q = startQty;
  let s = startSum;
  for (const t of txs) {
    q += t.qty_in - t.qty_out;
    s += t.sum_in - t.sum_out;
  }
  return Math.abs(q - endQty) <= QTY_EPS && Math.abs(s - endSum) <= SUM_EPS;
}

export function aggregate(bal: BalAgg | undefined, txs: TxAgg[]): Agg {
  const b = bal ?? { start_qty: 0, start_sum: 0, end_qty: 0, end_sum: 0 };
  const qty: Cells = { start: b.start_qty, end: b.end_qty };
  const sum: Cells = { start: b.start_sum, end: b.end_sum };
  const transfer = { qty_in: 0, qty_out: 0, sum_in: 0, sum_out: 0 };
  for (const t of txs) {
    const key = columnOf(t.tx_type);
    const sign = isOutflow(key) ? -1 : 1;
    qty[key] = (qty[key] ?? 0) + sign * (t.qty_in - t.qty_out);
    sum[key] = (sum[key] ?? 0) + sign * (t.sum_in - t.sum_out);
    if (key === "transfer") {
      transfer.qty_in += t.qty_in;
      transfer.qty_out += t.qty_out;
      transfer.sum_in += t.sum_in;
      transfer.sum_out += t.sum_out;
    }
  }
  return { qty, sum, transfer, consistent: isConsistent(b.start_qty, b.start_sum, txs, b.end_qty, b.end_sum) };
}

const nonZero = (v: number | undefined, eps: number) => v !== undefined && Math.abs(v) > eps;

/** Колонки выдачи: «всегда» + доп. с ненулевым значением. withSums=false — без cost_correction (филиал). */
export function visibleColumns(aggs: Agg[], withSums: boolean): TurnoverColumn[] {
  const out: TurnoverColumn[] = [];
  for (const key of COLUMN_ORDER) {
    if (key === "cost_correction") {
      if (withSums && aggs.some((a) => nonZero(a.sum[key], 0.005))) out.push({ key, sum_only: true });
      continue;
    }
    if (ALWAYS.has(key) || aggs.some((a) => nonZero(a.qty[key], 0.00005) || (withSums && nonZero(a.sum[key], 0.005)))) {
      out.push({ key });
    }
  }
  return out;
}

export type TurnoverBounds = { from: string; to: string; startAt: string; endAt: string };

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const tashkentToday = (now: Date) => new Date(now.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
const prevDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Границы снимка. null — у текущего месяца ещё нет прошедшего дня (1-е число). */
export function turnoverBounds(period: string, now: Date): TurnoverBounds | null {
  if (!isValidPeriod(period)) throw new InventoryError(422, "bad_period");
  const current = allowedPeriods(now)[0];
  if (period > current) throw new InventoryError(422, "future_period");
  const from = `${period.slice(0, 8)}01`;
  const yesterday = prevDay(tashkentToday(now));
  const to = period === current ? yesterday : period;
  if (to < from) return null;
  return { from, to, startAt: `${from}T00:00:00`, endAt: `${nextDay(to)}T00:00:00` };
}

export type IikoBal = { store_id: string; product_id: string; amount: number; sum: number };
export type IikoTx = { store_id: string; product_id: string; type: string; qty_in: number; qty_out: number; sum_in: number; sum_out: number };
export type SnapshotBalance = { product_id: string; start_qty: number; start_sum: number; end_qty: number; end_sum: number; consistent: boolean };

const isZeroBal = (b: IikoBal) => Math.abs(b.amount) <= 0.00005 && Math.abs(b.sum) <= 0.005;

/** Снимок одного склада: товары с ненулевым началом, концом или ненулевым движением. */
export function buildStoreSnapshot(storeId: string, start: IikoBal[], end: IikoBal[], txs: IikoTx[]) {
  const s = new Map(start.filter((b) => b.store_id === storeId && !isZeroBal(b)).map((b) => [b.product_id, b]));
  const e = new Map(end.filter((b) => b.store_id === storeId && !isZeroBal(b)).map((b) => [b.product_id, b]));
  // Инвентаризация iiko перечисляет все товары, и с нулевой разницей: такие проводки — половина строк месяца.
  const isEmpty = (t: IikoTx) =>
    Math.abs(t.qty_in) <= 0.00005 && Math.abs(t.qty_out) <= 0.00005 && Math.abs(t.sum_in) <= 0.005 && Math.abs(t.sum_out) <= 0.005;
  const turnover = txs.filter((t) => t.store_id === storeId && !isEmpty(t));
  const byProduct = new Map<string, TxAgg[]>();
  for (const t of turnover) {
    const list = byProduct.get(t.product_id) ?? [];
    list.push({ tx_type: t.type, qty_in: t.qty_in, qty_out: t.qty_out, sum_in: t.sum_in, sum_out: t.sum_out });
    byProduct.set(t.product_id, list);
  }
  const ids = new Set([...s.keys(), ...e.keys(), ...byProduct.keys()]);
  const balances: SnapshotBalance[] = [...ids].map((id) => {
    const b = { start_qty: s.get(id)?.amount ?? 0, start_sum: s.get(id)?.sum ?? 0, end_qty: e.get(id)?.amount ?? 0, end_sum: e.get(id)?.sum ?? 0 };
    return { product_id: id, ...b, consistent: isConsistent(b.start_qty, b.start_sum, byProduct.get(id) ?? [], b.end_qty, b.end_sum) };
  });
  return { balances, turnover };
}

export type MonthlyState = { exists: boolean; changeable: boolean };

/**
 * Какие месяцы видит филиал (spec 2026-10-14, решение 5): текущий — никогда; прошедший — пока месячный
 * пересчёт склада за него можно изменить (черновик или возврат: старые тоже можно вернуть), закрыт;
 * прошлый ещё и без пересчёта закрыт — за его дни разрешён промежуточный.
 */
export function branchMonthState(period: string, now: Date, m: MonthlyState): { open: boolean; reason: "current" | "not_fixed" | null } {
  const [current, previous] = allowedPeriods(now);
  if (period >= current) return { open: false, reason: "current" };
  if (m.changeable || (period === previous && !m.exists)) return { open: false, reason: "not_fixed" };
  return { open: true, reason: null };
}
