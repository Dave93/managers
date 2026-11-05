// Список «Сотрудники KPI»: отбор, вкладки и сортировка строк GET /kpi/people.
import type { PeopleRow } from "@admin/lib/kpi-api";
import { rowStatus } from "./status";
import { matchesQuery, nameOf } from "./timesheet";

export type PeopleTab = "all" | "none" | "disputed" | "violations" | "absent";
export type PeopleSort = "default" | "score" | "absent" | "late" | "violations";

export const PEOPLE_TABS: PeopleTab[] = ["all", "none", "disputed", "violations", "absent"];

export function matchesPeopleTab(r: PeopleRow, tab: PeopleTab): boolean {
  switch (tab) {
    case "all":
      return true;
    // Ждут оценки: карта есть, а отправленной оценки за месяц нет (черновик тоже ещё не оценка)
    case "none": {
      const s = rowStatus(r);
      return r.card !== null && (s === "none" || s === "draft");
    }
    case "disputed":
      return r.open_dispute;
    case "violations":
      return r.violations > 0;
    case "absent":
      return r.attendance.absent > 0;
  }
}

export function peopleTabCounts(rows: readonly PeopleRow[]): Record<PeopleTab, number> {
  const c: Record<PeopleTab, number> = { all: rows.length, none: 0, disputed: 0, violations: 0, absent: 0 };
  for (const r of rows) for (const t of PEOPLE_TABS) if (t !== "all" && matchesPeopleTab(r, t)) c[t]++;
  return c;
}

export function filterPeople(rows: readonly PeopleRow[], f: { tab: PeopleTab; terminal: string | null; query: string }): PeopleRow[] {
  return rows.filter((r) => (f.terminal === null || r.terminal_id === f.terminal) && matchesPeopleTab(r, f.tab) && matchesQuery(r, f.query));
}

/** Балл у оценённого; null — оценки нет или балла нет (его ставит оценщик, но пункты могли остаться пустыми). */
export function scoreOf(r: Pick<PeopleRow, "review">): number | null {
  return r.review && r.review.status === "submitted" ? r.review.score_pct : null;
}

/**
 * Сортировка по колонке. Балл: меньший выше (кому хуже, тот первым), без балла в конец.
 * Прогулы, опоздания, нарушения: больший выше. При равенстве остаётся порядок сервера (филиал, фамилия).
 * `default` порядок не меняет.
 */
export function sortPeople(rows: readonly PeopleRow[], key: PeopleSort): PeopleRow[] {
  if (key === "default") return [...rows];
  const value = (r: PeopleRow): number | null => {
    switch (key) {
      case "score":
        return scoreOf(r);
      case "absent":
        return r.attendance.absent;
      case "late":
        return r.attendance.late;
      case "violations":
        return r.violations;
    }
  };
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return idx.get(a.id)! - idx.get(b.id)!;
    if (x === null) return 1;
    if (y === null) return -1;
    return (key === "score" ? x - y : y - x) || idx.get(a.id)! - idx.get(b.id)!;
  });
}

export interface PeopleSummary {
  total: number;
  scored: number;
  disputed: number;
  violations: number;
  absent: number;
}

export function summarizePeople(rows: readonly PeopleRow[]): PeopleSummary {
  return {
    total: rows.length,
    scored: rows.filter((r) => scoreOf(r) !== null).length,
    disputed: rows.filter((r) => r.open_dispute).length,
    violations: rows.reduce((n, r) => n + r.violations, 0),
    absent: rows.reduce((n, r) => n + r.attendance.absent, 0),
  };
}

export { nameOf };
