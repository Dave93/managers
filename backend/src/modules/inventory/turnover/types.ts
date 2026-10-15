// Типы ответов оборотно-сальдовой ведомости (spec 2026-10-14, §7). Без импортов: admin берёт через `import type`.
// Числа — строкой без хвостовых нулей.

export type TurnoverColumnKey =
  | "start" | "invoice" | "sales" | "transfer" | "writeoff" | "inventory"
  | "outgoing_invoice" | "returned_invoice" | "transformation" | "production"
  | "cost_correction" | "other" | "end";

/** sum_only — колонка только для режима «Сумма» (корректировка себестоимости: количество всегда 0). */
export type TurnoverColumn = { key: TurnoverColumnKey; sum_only?: true };
export type TurnoverCells = Partial<Record<TurnoverColumnKey, string>>;

export interface TurnoverTransfer { qty_in: string; qty_out: string; sum_in?: string; sum_out?: string }

export interface TurnoverLine {
  product_id: string;
  code: string | null;
  name: string;
  unit_name: string | null;
  group_name: string;
  qty: TurnoverCells;
  /** Только офису. Филиалу ключа нет. */
  sum?: TurnoverCells;
  transfer: TurnoverTransfer;
  consistent: boolean;
}

export interface TurnoverSnapshotInfo { fetched_at: string | null; data_through: string | null }

export interface TurnoverStoreView extends TurnoverSnapshotInfo {
  period: string;
  store_id: string;
  store_name: string;
  with_sums: boolean;
  columns: TurnoverColumn[];
  lines: TurnoverLine[];
}

export interface TurnoverSummaryRow extends TurnoverSnapshotInfo {
  store_id: string;
  store_name: string;
  sum: TurnoverCells;
  inconsistent: number;
}

export type TurnoverFetchState = "idle" | "queued" | "running" | "done" | "failed";
export interface TurnoverFetchStatus {
  period: string;
  store_id: string | null;
  state: TurnoverFetchState;
  total: number;
  done: number;
  /** Склады, которые не загрузились (у них остался прежний снимок). */
  failed: string[];
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}
export interface TurnoverFetchOverview extends TurnoverFetchStatus { stores: TurnoverFetchStatus[] }

export interface TurnoverSummary {
  period: string;
  columns: TurnoverColumn[];
  rows: TurnoverSummaryRow[];
  total: TurnoverCells;
  status: TurnoverFetchOverview;
}

export interface TurnoverPeriod extends TurnoverSnapshotInfo {
  period: string;
  open: boolean;
  /** current — текущий месяц; not_fixed — месячный пересчёт не зафиксирован. */
  reason: "current" | "not_fixed" | null;
}
