import type { CashierKpi } from "./types";

export type Metric = "revenue" | "avg_check" | "orders_per_hour";

// Below this order count a cashier's avg-check / orders-per-hour figures are
// too noisy on a handful of shifts to rank meaningfully.
export const MIN_ORDERS_FOR_AVG = 20;

export type RankedRow = { name: string; current: number; previous: number | null };

// Cashier logins are per iiko account, and branches share logins between
// people, so two rows can carry the same display name. Disambiguate only
// the rows that actually end up on screen (post filter, post limit) — a
// duplicate that limit sliced away needs no suffix.
export function toRankedRows(
  cashiers: CashierKpi[],
  metric: Metric,
  opts?: { minOrders?: number; limit?: number }
): RankedRow[] {
  const minOrders = opts?.minOrders ?? 0;
  const filtered = cashiers.filter((c) => c.orders >= minOrders);
  const sorted = [...filtered].sort((a, b) => b[metric] - a[metric]);
  const limited = opts?.limit != null ? sorted.slice(0, opts.limit) : sorted;

  const nameCounts = new Map<string, number>();
  for (const c of limited) nameCounts.set(c.cashier_name, (nameCounts.get(c.cashier_name) ?? 0) + 1);

  return limited.map((c) => ({
    name:
      (nameCounts.get(c.cashier_name) ?? 0) > 1
        ? `${c.cashier_name} · ${c.terminal_name ?? "?"}`
        : c.cashier_name,
    current: c[metric],
    previous: c.prev ? c.prev[metric] : null,
  }));
}

// Weighted where a plain mean would mislead: avg_check and orders_per_hour
// are ratios, so they average by summing their numerator/denominator across
// the kept cashiers rather than averaging the per-cashier ratios.
export function networkAverage(cashiers: CashierKpi[], metric: Metric, minOrders?: number): number {
  const kept = cashiers.filter((c) => c.orders >= (minOrders ?? 0));
  if (kept.length === 0) return 0;

  if (metric === "avg_check") {
    const revenue = kept.reduce((s, c) => s + c.revenue, 0);
    const orders = kept.reduce((s, c) => s + c.orders, 0);
    return orders > 0 ? revenue / orders : 0;
  }
  if (metric === "orders_per_hour") {
    const orders = kept.reduce((s, c) => s + c.orders, 0);
    const hours = kept.reduce((s, c) => s + c.hours, 0);
    return hours > 0 ? orders / hours : 0;
  }
  return kept.reduce((s, c) => s + c.revenue, 0) / kept.length;
}

export function activeCashiers(cashiers: CashierKpi[]): number {
  return cashiers.filter((c) => c.shifts > 0).length;
}
