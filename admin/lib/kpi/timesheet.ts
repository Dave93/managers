// Табель посещаемости: чистые функции над ответом GET /kpi/attendance/board.
// Статусы дня приходят от Workly через синхронизацию; здесь только счёт и отбор.
import type { BoardDay, BoardEmployee } from "@admin/lib/kpi-api";

export type DayStatus = "ontime" | "late" | "absent";
export type Tab = "all" | "absent" | "late" | "nodata";

const STATUS: Record<BoardDay[0], DayStatus> = { 0: "ontime", 1: "late", 2: "absent" };

export function statusOf(d: BoardDay | null): DayStatus | null {
  return d ? STATUS[d[0]] : null;
}

export interface Totals {
  ontime: number;
  late: number;
  absent: number;
  /** Дни с записью: вовремя, с опозданием и прогулы. Пустые дни не входят. */
  recorded: number;
}

export function totalsOf(days: readonly (BoardDay | null)[]): Totals {
  const t: Totals = { ontime: 0, late: 0, absent: 0, recorded: 0 };
  for (const d of days) {
    const s = statusOf(d);
    if (!s) continue;
    t[s]++;
    t.recorded++;
  }
  return t;
}

export function sumTotals(list: readonly Totals[]): Totals {
  return list.reduce(
    (a, t) => ({ ontime: a.ontime + t.ontime, late: a.late + t.late, absent: a.absent + t.absent, recorded: a.recorded + t.recorded }),
    { ontime: 0, late: 0, absent: 0, recorded: 0 }
  );
}

/** Доля прогулов среди дней с записью, в процентах; null, если записей нет. */
export function absentShare(t: Pick<Totals, "absent" | "recorded">): number | null {
  return t.recorded === 0 ? null : (100 * t.absent) / t.recorded;
}

/** Доля опозданий среди дней присутствия (вовремя и с опозданием), в процентах. */
export function lateShare(t: Pick<Totals, "ontime" | "late">): number | null {
  const present = t.ontime + t.late;
  return present === 0 ? null : (100 * t.late) / present;
}

export interface BranchStat extends Totals {
  id: string;
  name: string;
  /** Организация филиала: сравнение идёт только внутри неё */
  organization: string | null;
  employees: number;
  share: number | null;
  above: boolean;
}

export interface OrgMedian {
  organization: string | null;
  name: string | null;
  /** Медиана долей прогулов по филиалам организации, в процентах */
  median: number;
}

export function medianOf(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Доли прогулов по филиалам и медиана внутри каждой организации. «Выше нормы» — доля больше удвоенной
 * медианы своей организации; при нулевой медиане — больше 50%. То же правило и тот же состав сравнения,
 * что в блоке качества на экране «Синхронизация Workly»: у него медиана тоже по организации.
 */
export function branchStats(emps: readonly BoardEmployee[]): { branches: BranchStat[]; medians: OrgMedian[] } {
  const by = new Map<string, { name: string; org: string | null; emps: number; totals: Totals[] }>();
  const orgNames = new Map<string | null, string | null>();
  for (const e of emps) {
    orgNames.set(e.organization_id, e.organization_name);
    const b = by.get(e.terminal_id) ?? { name: e.terminal_name ?? e.terminal_id, org: e.organization_id, emps: 0, totals: [] };
    b.emps++;
    b.totals.push(totalsOf(e.days));
    by.set(e.terminal_id, b);
  }
  const rows: BranchStat[] = [...by].map(([id, b]) => {
    const t = sumTotals(b.totals);
    return { id, name: b.name, organization: b.org, employees: b.emps, ...t, share: absentShare(t), above: false };
  });
  const medians: OrgMedian[] = [...orgNames]
    .map(([organization, name]) => ({
      organization,
      name,
      median: medianOf(rows.flatMap((r) => (r.organization === organization && r.share !== null ? [r.share] : []))),
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ru"));
  const byOrg = new Map(medians.map((m) => [m.organization, m.median]));
  for (const r of rows) {
    const median = byOrg.get(r.organization) ?? 0;
    r.above = r.share !== null && (median === 0 ? r.share > 50 : r.share > 2 * median);
  }
  rows.sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || a.name.localeCompare(b.name, "ru"));
  return { branches: rows, medians };
}

export function nameOf(e: Pick<BoardEmployee, "first_name" | "last_name">): string {
  return `${e.last_name} ${e.first_name}`.trim();
}

export function matchesTab(e: BoardEmployee, tab: Tab): boolean {
  const t = totalsOf(e.days);
  switch (tab) {
    case "all":
      return true;
    case "absent":
      return t.absent > 0;
    case "late":
      return t.late > 0;
    case "nodata":
      return t.recorded === 0;
  }
}

export function tabCounts(emps: readonly BoardEmployee[]): Record<Tab, number> {
  const c: Record<Tab, number> = { all: emps.length, absent: 0, late: 0, nodata: 0 };
  for (const e of emps) for (const k of ["absent", "late", "nodata"] as const) if (matchesTab(e, k)) c[k]++;
  return c;
}

/** Слова запроса, каждое должно встретиться в «фамилия имя»; порядок слов не важен. */
export function matchesQuery(e: Pick<BoardEmployee, "first_name" | "last_name">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = nameOf(e).toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface Filters {
  tab: Tab;
  /** id филиала; null — все */
  terminal: string | null;
  query: string;
}

export function filterBoard(emps: readonly BoardEmployee[], f: Filters): BoardEmployee[] {
  return emps.filter((e) => (f.terminal === null || e.terminal_id === f.terminal) && matchesTab(e, f.tab) && matchesQuery(e, f.query));
}

export interface Group {
  id: string;
  name: string;
  employees: BoardEmployee[];
}

/**
 * Подряд идущие сотрудники одного филиала в одну группу. Внутри группы сотрудники без единой записи
 * уходят в конец: на «Все» вперёд идут те, о ком есть что сказать. Порядок остальных сохраняется.
 */
export function groupByTerminal(emps: readonly BoardEmployee[]): Group[] {
  const out: Group[] = [];
  for (const e of emps) {
    const last = out[out.length - 1];
    if (last && last.id === e.terminal_id) last.employees.push(e);
    else out.push({ id: e.terminal_id, name: e.terminal_name ?? e.terminal_id, employees: [e] });
  }
  for (const g of out) {
    const withData = g.employees.filter((e) => totalsOf(e.days).recorded > 0);
    g.employees = [...withData, ...g.employees.filter((e) => !withData.includes(e))];
  }
  return out;
}

/** Доля в процентах с одним знаком и запятой: «20,2 %». Для итоговой строки; в таблицах целые числа дней. */
export function formatShare(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(Math.round(n * 10) / 10).toFixed(1).replace(".", ",")}\u00a0%`;
}

/** Самая длинная серия прогулов подряд. */
export function absentStreak(days: readonly (BoardDay | null)[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    run = statusOf(d) === "absent" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** Дни, где что-то пошло не так, по порядку месяца: номер дня и запись. */
export function deviations(days: readonly (BoardDay | null)[]): { day: number; entry: BoardDay }[] {
  const out: { day: number; entry: BoardDay }[] = [];
  days.forEach((d, i) => {
    if (d && d[0] !== 0) out.push({ day: i + 1, entry: d });
  });
  return out;
}


/** День недели дня месяца: 0 — понедельник … 6 — воскресенье. */
export function weekdayOf(period: string, day: number): number {
  const [y, m] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
  return (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7;
}

/** Сетка месяца с понедельника: null — пустые клетки до первого числа. */
export function calendarCells(period: string, daysInMonth: number): (number | null)[] {
  const lead = weekdayOf(period, 1);
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
}

/** Сегодняшний день по Ташкенту, YYYY-MM-DD. */
export function tashkentToday(now: Date): string {
  return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * День, по которому записи ещё нет и не должно быть: сегодня и позже (синхронизация идёт по вчерашний день).
 * Его пустую клетку не показываем как «нет записи».
 */
export function isPendingDay(period: string, day: number, today: string): boolean {
  return `${period.slice(0, 8)}${String(day).padStart(2, "0")}` >= today;
}

/** Номер дня месяца «сегодня» или null, если сегодня в другом месяце. */
export function todayInPeriod(period: string, today: string): number | null {
  return today.slice(0, 7) === period.slice(0, 7) ? Number(today.slice(8, 10)) : null;
}

