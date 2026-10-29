// Фильтры и списки выбора по строкам сотрудников. Всё считается на клиенте по уже загруженным строкам.
import type { EmployeeRow } from "@admin/lib/kpi-api";
import { rowStatus, type RowStatus } from "./status";

/** Сентинел «все» для Select: Radix не принимает пустую строку как value. */
export const ALL = "__all__";
export type Option = { id: string; name: string };

const NO_TERMINAL_NAME = "Филиал без названия";

export function employeeName(r: { first_name: string; last_name: string }): string {
  return `${r.last_name.trim()} ${r.first_name.trim()}`.trim();
}

function byName(a: Option, b: Option): number {
  return a.name.localeCompare(b.name, "ru");
}

export function terminalOptions(rows: readonly { terminal_id: string; terminal_name: string | null }[]): Option[] {
  const seen = new Map<string, Option>();
  for (const r of rows) {
    if (!seen.has(r.terminal_id)) seen.set(r.terminal_id, { id: r.terminal_id, name: r.terminal_name ?? NO_TERMINAL_NAME });
  }
  return [...seen.values()].sort(byName);
}

export function cardOptions(rows: readonly Pick<EmployeeRow, "card">[]): Option[] {
  const seen = new Map<string, Option>();
  for (const r of rows) {
    if (r.card && !seen.has(r.card.id)) seen.set(r.card.id, { id: r.card.id, name: r.card.title_ru });
  }
  return [...seen.values()].sort(byName);
}

export type RowFilter = { terminal_id: string; card_id: string; status: RowStatus | typeof ALL; search: string };

export function filterRows(rows: EmployeeRow[], f: RowFilter): EmployeeRow[] {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.terminal_id !== ALL && r.terminal_id !== f.terminal_id) return false;
    if (f.card_id !== ALL && r.card?.id !== f.card_id) return false;
    if (f.status !== ALL && rowStatus(r) !== f.status) return false;
    if (words.length) {
      const name = employeeName(r).toLowerCase();
      if (!words.every((w) => name.includes(w))) return false;
    }
    return true;
  });
}

export function statusCounts(rows: readonly Pick<EmployeeRow, "review" | "open_dispute">[]): Record<RowStatus, number> {
  const out: Record<RowStatus, number> = { none: 0, draft: 0, submitted: 0, disputed: 0 };
  for (const r of rows) out[rowStatus(r)] += 1;
  return out;
}
