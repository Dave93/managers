// Экран ОСВ: какие колонки показывать в режиме, какие со знаком. Колонки и значения считает сервер.
import type { TurnoverCells, TurnoverColumn, TurnoverColumnKey } from "@backend/modules/inventory/turnover/types";

export type TurnoverMode = "qty" | "sum";

const SIGNED = new Set<TurnoverColumnKey>(["transfer", "inventory", "transformation", "production", "cost_correction", "other"]);
export const isSigned = (key: TurnoverColumnKey) => SIGNED.has(key);

export function columnsFor(columns: TurnoverColumn[], mode: TurnoverMode): TurnoverColumn[] {
  return mode === "qty" ? columns.filter((c) => !c.sum_only) : columns;
}

export function cellOf(row: { qty?: TurnoverCells; sum?: TurnoverCells }, key: TurnoverColumnKey, mode: TurnoverMode): string {
  return (mode === "sum" ? row.sum : row.qty)?.[key] ?? "0";
}
