// Чистые помощники экранов балла филиала: цвета, форматы, форма настроек показателей.
// Типы — только import type: модуль не тянет клиент API в тесты и в errors.ts.
import type {
  BranchBreakdown,
  BranchCell,
  BranchDirection,
  BranchIndicator,
  BranchIndicatorCode,
  BranchScoreRow,
  IndicatorInput,
  NoDataReason,
} from "@admin/lib/kpi-api";
import { formatPct, formatSum, roundTo } from "./format";
import { ruT, type KpiT } from "./i18n";
import { addMonths, calendarPeriod } from "./periods";
import type { Tone } from "./status";


/** Ключи подписей показателей: `t(INDICATOR_LABEL_KEY[code])`. */
export const INDICATOR_LABEL_KEY: Record<BranchIndicatorCode, string> = {
  sales: "lib.indicator.sales",
  food_cost: "lib.indicator.food_cost",
  service: "lib.indicator.service",
  sanitary: "lib.indicator.sanitary",
  discipline: "lib.indicator.discipline",
};

/** Русские подписи (запасной вариант без `t`). */
export const INDICATOR_LABEL: Record<BranchIndicatorCode, string> = Object.fromEntries(
  Object.entries(INDICATOR_LABEL_KEY).map(([k, key]) => [k, ruT(key)])
) as Record<BranchIndicatorCode, string>;

/** Ключи причин «нет данных»: `t(NO_DATA_REASON_KEY[reason])`. */
export const NO_DATA_REASON_KEY: Record<NoDataReason, string> = {
  not_computed: "lib.noData.not_computed",
  no_iiko_link: "lib.noData.no_iiko_link",
  no_plan: "lib.noData.no_plan",
  no_orders: "lib.noData.no_orders",
  no_store: "lib.noData.no_store",
  no_reconciliation: "lib.noData.no_reconciliation",
  not_accepted: "lib.noData.not_accepted",
  no_iiko_document: "lib.noData.no_iiko_document",
  no_cooking_rows: "lib.noData.no_cooking_rows",
  no_checks: "lib.noData.no_checks",
  no_attendance: "lib.noData.no_attendance",
};

/** Русские тексты причин (запасной вариант без `t`). */
export const NO_DATA_REASON_TEXT: Record<NoDataReason, string> = Object.fromEntries(
  Object.entries(NO_DATA_REASON_KEY).map(([k, key]) => [k, ruT(key)])
) as Record<NoDataReason, string>;

const round2 = (n: number) => roundTo(n, 2);
const comma = (s: string) => s.replace(".", ",");

/** Цвет ячейки «Сети» по баллам показателя: от 100 зелёный, больше 0 жёлтый, 0 красный, без данных серый. */
export function cellTone(c: Pick<BranchCell, "points" | "data_status"> | undefined): Tone {
  if (!c || c.data_status !== "ok" || c.points === null) return "gray";
  // Пороги по баллам, как их показывает экран (до 0,1): 99,96 выводится «100,0» и не должно быть жёлтым.
  const shown = roundTo(c.points, 1);
  if (shown >= 100) return "green";
  return shown > 0 ? "amber" : "red";
}

export function tierTone(pct: number | null): Tone {
  if (pct === 120) return "blue";
  if (pct === 100) return "green";
  if (pct === 60) return "amber";
  if (pct === 0) return "red";
  return "gray";
}

const TIER_ORDER = [120, 100, 60, 0] as const;

export function tierCounts(rows: readonly Pick<BranchScoreRow, "tier_pct">[]): { pct: number; count: number }[] {
  return TIER_ORDER.map((pct) => ({ pct, count: rows.filter((r) => r.tier_pct === pct).length }));
}

export function networkAverage(rows: readonly Pick<BranchScoreRow, "score">[]): number | null {
  if (rows.length === 0) return null;
  return round2(rows.reduce((a, r) => a + r.score, 0) / rows.length);
}

export function formatFact(fact: number | null, t: KpiT = ruT): string {
  return fact === null ? t("lib.branch.noDataValue") : formatPct(fact);
}

export function formatPoints(p: number | null): string {
  return p === null || !Number.isFinite(p) ? "—" : comma(roundTo(p, 1).toFixed(1));
}

export function formatScore(s: number | null): string {
  return s === null || !Number.isFinite(s) ? "—" : comma(roundTo(s, 2).toFixed(2));
}

export function nextTierText(n: BranchBreakdown["next_tier"], t: KpiT = ruT): string {
  if (n === null) return t("lib.branch.topTier");
  return t("lib.branch.nextTier", { pct: n.tier_pct, points: formatPoints(n.points_needed) });
}

const int = (n: number) => comma(String(n));

/** Подпись факта под карточкой показателя; нужного числа нет — пустая строка. */
export function detailsText(code: BranchIndicatorCode, d: Record<string, number | null>, t: KpiT = ruT): string {
  const need = (...keys: string[]): number[] | null => {
    const out: number[] = [];
    for (const k of keys) {
      const v = d[k];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      out.push(v);
    }
    return out;
  };
  switch (code) {
    case "sales": {
      const v = need("revenue", "plan");
      return v ? t("lib.branch.details.sales", { revenue: formatSum(v[0], t), plan: formatSum(v[1], t) }) : "";
    }
    case "food_cost": {
      const v = need("overspend", "revenue");
      return v ? t("lib.branch.details.food_cost", { over: formatSum(v[0], t), revenue: formatSum(v[1], t) }) : "";
    }
    case "service": {
      const v = need("on_time", "orders", "hall_min", "delivery_min");
      return v ? t("lib.branch.details.service", { onTime: int(v[0]), orders: int(v[1]), hall: int(v[2]), delivery: int(v[3]) }) : "";
    }
    case "sanitary": {
      const v = need("checks");
      return v ? t("lib.branch.details.sanitary", { count: int(v[0]) }) : "";
    }
    case "discipline": {
      const v = need("on_time", "days", "late", "absent");
      return v ? t("lib.branch.details.discipline", { onTime: int(v[0]), days: int(v[1]), late: int(v[2]), absent: int(v[3]) }) : "";
    }
  }
}

// --- Предварительная версия, покрытие весом, склады, проверки после расчёта ---

export const PRELIMINARY_TEXT = ruT("lib.branch.preliminary");
/** Пометка «после расчёта появились проверки, планы или импорт посещаемости». Пересчёт HR запускает вручную. */
export const NEW_DATA_TEXT = ruT("lib.branch.newData");
export const NEW_DATA_TEXT_READONLY = ruT("lib.branch.newDataReadonly");
export const NEW_DATA_LINK_TEXT = ruT("lib.branch.newDataLink");

/** Пометка и ссылка на «Сеть», где живёт «Пересчитать»; без права пересчёта — пометка без кнопки. На самой «Сети» ссылки нет. */
export function newDataHint(
  data: { inputs_newer: boolean; version: number | null },
  o: { canCompute: boolean; period: string; onNetwork: boolean },
  t: KpiT = ruT
): { text: string; href: string | null } | null {
  if (!data.inputs_newer || data.version === null) return null;
  if (!o.canCompute) return { text: t("lib.branch.newDataReadonly"), href: null };
  return { text: t("lib.branch.newData"), href: o.onNetwork ? null : `/kpi/network?period=${o.period}` };
}

export const COMPUTE_CONFIRM_TEXT = ruT("lib.branch.computeConfirm");

/** Месяц экранов балла по умолчанию — последний завершённый: у текущего продажи к месячному плану ещё не набраны. */
export function defaultBranchPeriod(now: Date): string {
  return addMonths(calendarPeriod(now), -1);
}

/** Месяц ещё идёт (или не начался): расчёт за него будет предварительным. */
export function monthIncomplete(period: string, now: Date): boolean {
  return period >= calendarPeriod(now);
}

type WeightRow = { weight: number; data_status: "ok" | "no_data" };

const okWeight = (list: readonly WeightRow[]) => list.reduce((a, r) => (r.data_status === "ok" ? a + r.weight : a), 0);

/** Доля веса показателей с данными среди всех строк версии филиала, % до 0,1; строк нет — null. */
export function weightCoverage(list: readonly WeightRow[]): number | null {
  const total = list.reduce((a, r) => a + r.weight, 0);
  if (!(total > 0)) return null;
  return roundTo((100 * okWeight(list)) / total, 1);
}

/** «по 85 % веса», когда балл посчитан не по всему весу; иначе пусто. */
export function coverageText(list: readonly WeightRow[], t: KpiT = ruT): string {
  const c = weightCoverage(list);
  return c === null || c >= 100 ? "" : t("lib.branch.coverage", { pct: comma(String(c)) });
}

/** Вес показателя; при неполном покрытии — и фактическая доля в балле (вес ÷ вес с данными). */
export function weightText(weight: number, list: readonly WeightRow[], t: KpiT = ruT): string {
  const base = t("lib.branch.weight", { weight: int(weight) });
  const c = weightCoverage(list);
  const ok = okWeight(list);
  if (c === null || c >= 100 || !(ok > 0)) return base;
  return t("lib.branch.weightActual", { base, pct: comma(String(roundTo((100 * weight) / ok, 1))) });
}

/** Строка карточки показателя с данными: баллы, вес и вклад в балл филиала. */
export function indicatorLine(r: { points: number | null; weight: number; weighted: number | null }, list: readonly WeightRow[], t: KpiT = ruT): string {
  return t("lib.branch.line", { points: formatPoints(r.points), weight: weightText(r.weight, list, t), weighted: formatScore(r.weighted) });
}

/** Подробность «нет данных»: у себестоимости без принятой сверки — сколько складов принято. */
export function noDataDetailsText(code: BranchIndicatorCode, reason: NoDataReason | null, d: Record<string, number | null>, t: KpiT = ruT): string {
  if (code !== "food_cost" || (reason !== "not_accepted" && reason !== "no_reconciliation")) return "";
  const total = d.stores_total;
  const done = d.stores_reconciled;
  if (typeof total !== "number" || typeof done !== "number" || !Number.isFinite(total) || !Number.isFinite(done)) return "";
  // «из 1 склада», «из 2 складов», «из 21 склада», «из 11 складов»: форму выбирает plural по числу складов.
  return t("lib.branch.storesDone", { done: int(done), total: int(total), n: total });
}

/** Проверка заведена после расчёта версии: в балле её ещё нет. Решает created_at — checked_at бывает задним числом. */
export function countedLater(c: { created_at: string }, computedAt: string | null): boolean {
  if (computedAt === null) return false;
  return new Date(c.created_at).getTime() > new Date(computedAt).getTime();
}

// --- Настройки показателей ---

export type IndicatorDraft = {
  code: BranchIndicatorCode;
  title_ru: string;
  direction: BranchDirection;
  active: boolean;
  weight: string;
  floor: string;
  target: string;
  max: string;
};

export function indicatorDraft(list: readonly BranchIndicator[]): IndicatorDraft[] {
  return list.map((i) => ({
    code: i.code,
    title_ru: i.title_ru,
    direction: i.direction,
    active: i.active,
    weight: String(i.weight),
    floor: comma(String(i.floor)),
    target: comma(String(i.target)),
    max: comma(String(i.max)),
  }));
}

/** Число с запятой или точкой, пробелы по краям; не число — null. */
export function parseDecimal(s: string): number | null {
  const t = s.trim().replace("−", "-");
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseWeight(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : null;
}

/** Сумма весов активных показателей; нечитаемый вес считается нулём. */
export function weightSum(d: readonly IndicatorDraft[]): number {
  return d.reduce((a, x) => (x.active ? a + (parseWeight(x.weight) ?? 0) : a), 0);
}

export function indicatorIssues(d: readonly IndicatorDraft[], t: KpiT = ruT): string[] {
  const out: string[] = [];
  for (const x of d) {
    const w = parseWeight(x.weight);
    if (w === null) out.push(t("lib.branch.issue.weight", { title: x.title_ru }));
    else if (x.active && w < 1) out.push(t("lib.branch.issue.activeWeight", { title: x.title_ru }));
    const floor = parseDecimal(x.floor);
    const target = parseDecimal(x.target);
    const max = parseDecimal(x.max);
    if (floor === null || target === null || max === null) {
      out.push(t("lib.branch.issue.numbers", { title: x.title_ru }));
    } else if (x.direction === "higher_better") {
      if (!(floor < target && target < max)) out.push(t("lib.branch.issue.orderUp", { title: x.title_ru }));
    } else if (!(floor > target && target > max)) {
      out.push(t("lib.branch.issue.orderDown", { title: x.title_ru }));
    }
  }
  const sum = weightSum(d);
  if (sum !== 100) out.push(t("lib.branch.issue.sum", { sum }));
  return out;
}

/** Тело PUT; вызывать, когда indicatorIssues пуст. */
export function indicatorBody(d: readonly IndicatorDraft[]): IndicatorInput[] {
  return d.map((x) => ({
    code: x.code,
    weight: parseWeight(x.weight) ?? NaN,
    floor: parseDecimal(x.floor) ?? NaN,
    target: parseDecimal(x.target) ?? NaN,
    max: parseDecimal(x.max) ?? NaN,
    active: x.active,
  }));
}

/** Пункты проверки из текстового поля: по строке, без пустых и повторов. */
export function sanitaryItemsFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t !== "" && !out.includes(t)) out.push(t);
  }
  return out;
}

function parseNorm(s: string): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 120 ? n : null;
}

export function branchSettingsIssues(s: { hall: string; delivery: string; items: readonly string[] }, t: KpiT = ruT): string[] {
  const out: string[] = [];
  if (parseNorm(s.hall) === null) out.push(t("lib.branch.settingsIssue.hall"));
  if (parseNorm(s.delivery) === null) out.push(t("lib.branch.settingsIssue.delivery"));
  if (s.items.length < 1 || s.items.length > 30) out.push(t("lib.branch.settingsIssue.count"));
  const titles = s.items.map((i) => i.trim());
  if (titles.some((t) => t.length < 1)) out.push(t("lib.branch.settingsIssue.empty"));
  if (titles.some((t) => t.length > 200)) out.push(t("lib.branch.settingsIssue.long"));
  if (new Set(titles).size !== titles.length) out.push(t("lib.branch.settingsIssue.dup"));
  return out;
}
