// Экран ОСВ: какие колонки показывать в режиме, какие со знаком. Колонки и значения считает сервер.
import type { TurnoverCells, TurnoverColumn, TurnoverColumnKey, TurnoverLine } from "@backend/modules/inventory/turnover/types";

export type TurnoverMode = "qty" | "sum";

const SIGNED = new Set<TurnoverColumnKey>(["transfer", "inventory", "transformation", "production", "cost_correction", "other"]);
export const isSigned = (key: TurnoverColumnKey) => SIGNED.has(key);

export function columnsFor(columns: TurnoverColumn[], mode: TurnoverMode): TurnoverColumn[] {
  return mode === "qty" ? columns.filter((c) => !c.sum_only) : columns;
}

export function cellOf(row: { qty?: TurnoverCells; sum?: TurnoverCells }, key: TurnoverColumnKey, mode: TurnoverMode): string {
  return (mode === "sum" ? row.sum : row.qty)?.[key] ?? "0";
}

/** Строки склада по группам, как на экране и в Excel. Строку из одних нулей в этом режиме не показываем
 * (например, менялась только сумма). Поиск — по названию или коду. */
export function turnoverGroups(lines: TurnoverLine[], mode: TurnoverMode, search = ""): [string, TurnoverLine[]][] {
  const q = search.trim().toLowerCase();
  const by = new Map<string, TurnoverLine[]>();
  for (const l of lines) {
    if (q && !l.name.toLowerCase().includes(q) && !(l.code ?? "").toLowerCase().includes(q)) continue;
    if (!Object.values((mode === "sum" ? l.sum : l.qty) ?? {}).some((v) => Math.abs(Number(v)) > 0.00005)) continue;
    by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
  }
  return [...by.entries()];
}
