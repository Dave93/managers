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
import { addMonths, calendarPeriod } from "./periods";
import type { Tone } from "./status";

const NBSP = " ";

export const INDICATOR_LABEL: Record<BranchIndicatorCode, string> = {
  sales: "Продажи",
  food_cost: "Себестоимость",
  service: "Сервис",
  sanitary: "Санитария",
  discipline: "Дисциплина",
};

export const NO_DATA_REASON_TEXT: Record<NoDataReason, string> = {
  not_computed: "Нет в последнем расчёте",
  no_iiko_link: "Филиал не связан с iiko",
  no_plan: "Нет плана выручки",
  no_orders: "Нет выручки за месяц",
  no_store: "Склад филиала не связан",
  no_reconciliation: "Нет сверки инвентаризации",
  not_accepted: "Сверка инвентаризации не принята",
  no_iiko_document: "В сверке нет документа iiko",
  no_cooking_rows: "Нет замеров времени приготовления",
  no_checks: "Не было санитарных проверок",
  no_attendance: "Нет загрузки Workly",
};

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

export function formatFact(fact: number | null): string {
  return fact === null ? "нет данных" : formatPct(fact);
}

export function formatPoints(p: number | null): string {
  return p === null || !Number.isFinite(p) ? "—" : comma(roundTo(p, 1).toFixed(1));
}

export function formatScore(s: number | null): string {
  return s === null || !Number.isFinite(s) ? "—" : comma(roundTo(s, 2).toFixed(2));
}

export function nextTierText(n: BranchBreakdown["next_tier"]): string {
  if (n === null) return "Высшая ступень";
  return `До ступени ${n.tier_pct}${NBSP}% не хватает ${formatPoints(n.points_needed)} балла`;
}

const int = (n: number) => comma(String(n));

/** Подпись факта под карточкой показателя; нужного числа нет — пустая строка. */
export function detailsText(code: BranchIndicatorCode, d: Record<string, number | null>): string {
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
      return v ? `Выручка ${formatSum(v[0])} при плане ${formatSum(v[1])}` : "";
    }
    case "food_cost": {
      const v = need("overspend", "revenue");
      return v ? `Перерасход ${formatSum(v[0])} при выручке ${formatSum(v[1])}` : "";
    }
    case "service": {
      const v = need("on_time", "orders", "hall_min", "delivery_min");
      return v ? `В норматив ${int(v[0])} из ${int(v[1])} заказов · зал ${int(v[2])} мин, доставка ${int(v[3])} мин` : "";
    }
    case "sanitary": {
      const v = need("checks");
      return v ? `Проверок: ${int(v[0])}` : "";
    }
    case "discipline": {
      const v = need("on_time", "days", "late", "absent");
      return v ? `Вовремя ${int(v[0])} из ${int(v[1])} · опозданий ${int(v[2])}, прогулов ${int(v[3])}` : "";
    }
  }
}

// --- Предварительная версия, покрытие весом, склады, проверки после расчёта ---

export const PRELIMINARY_TEXT =
  "Предварительно: месяц ещё не закончился, продажи к месячному плану занижены. Пересчитайте после окончания месяца";
/** Пометка «после расчёта появились проверки, планы или импорт посещаемости». Пересчёт HR запускает вручную. */
export const NEW_DATA_TEXT = "Есть новые данные — нажмите «Пересчитать»";
export const NEW_DATA_TEXT_READONLY = "Есть новые данные — балл обновится после пересчёта";
export const NEW_DATA_LINK_TEXT = "К пересчёту";

/** Пометка и ссылка на «Сеть», где живёт «Пересчитать»; без права пересчёта — пометка без кнопки. На самой «Сети» ссылки нет. */
export function newDataHint(
  data: { inputs_newer: boolean; version: number | null },
  o: { canCompute: boolean; period: string; onNetwork: boolean }
): { text: string; href: string | null } | null {
  if (!data.inputs_newer || data.version === null) return null;
  if (!o.canCompute) return { text: NEW_DATA_TEXT_READONLY, href: null };
  return { text: NEW_DATA_TEXT, href: o.onNetwork ? null : `/kpi/network?period=${o.period}` };
}

export const COMPUTE_CONFIRM_TEXT = "Месяц ещё не закончился — результат будет предварительным. Посчитать?";

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
export function coverageText(list: readonly WeightRow[]): string {
  const c = weightCoverage(list);
  return c === null || c >= 100 ? "" : `по ${comma(String(c))}${NBSP}% веса`;
}

/** Вес показателя; при неполном покрытии — и фактическая доля в балле (вес ÷ вес с данными). */
export function weightText(weight: number, list: readonly WeightRow[]): string {
  const base = `вес ${int(weight)}${NBSP}%`;
  const c = weightCoverage(list);
  const ok = okWeight(list);
  if (c === null || c >= 100 || !(ok > 0)) return base;
  return `${base} → фактически ${comma(String(roundTo((100 * weight) / ok, 1)))}${NBSP}%`;
}

/** Строка карточки показателя с данными: баллы, вес и вклад в балл филиала. */
export function indicatorLine(r: { points: number | null; weight: number; weighted: number | null }, list: readonly WeightRow[]): string {
  return `${formatPoints(r.points)} балла · ${weightText(r.weight, list)} · вклад ${formatScore(r.weighted)}`;
}

// «из 1 склада», «из 2 складов», «из 21 склада», «из 11 складов»
const storesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "склада" : "складов");

/** Подробность «нет данных»: у себестоимости без принятой сверки — сколько складов принято. */
export function noDataDetailsText(code: BranchIndicatorCode, reason: NoDataReason | null, d: Record<string, number | null>): string {
  if (code !== "food_cost" || (reason !== "not_accepted" && reason !== "no_reconciliation")) return "";
  const total = d.stores_total;
  const done = d.stores_reconciled;
  if (typeof total !== "number" || typeof done !== "number" || !Number.isFinite(total) || !Number.isFinite(done)) return "";
  return `принято ${int(done)} из ${int(total)} ${storesWord(total)}`;
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

export function indicatorIssues(d: readonly IndicatorDraft[]): string[] {
  const out: string[] = [];
  for (const x of d) {
    const w = parseWeight(x.weight);
    if (w === null) out.push(`${x.title_ru}: вес — целое от 0 до 100`);
    else if (x.active && w < 1) out.push(`${x.title_ru}: у активного показателя вес не меньше 1`);
    const floor = parseDecimal(x.floor);
    const target = parseDecimal(x.target);
    const max = parseDecimal(x.max);
    if (floor === null || target === null || max === null) {
      out.push(`${x.title_ru}: порог, цель и максимум — числа`);
    } else if (x.direction === "higher_better") {
      if (!(floor < target && target < max)) out.push(`${x.title_ru}: нужно порог < цель < максимум`);
    } else if (!(floor > target && target > max)) {
      out.push(`${x.title_ru}: нужно порог > цель > максимум`);
    }
  }
  const sum = weightSum(d);
  if (sum !== 100) out.push(`Сумма весов активных показателей ${sum}${NBSP}%, нужно 100${NBSP}%`);
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

export function branchSettingsIssues(s: { hall: string; delivery: string; items: readonly string[] }): string[] {
  const out: string[] = [];
  if (parseNorm(s.hall) === null) out.push("Норматив зала — целое от 1 до 120 минут");
  if (parseNorm(s.delivery) === null) out.push("Норматив доставки — целое от 1 до 120 минут");
  if (s.items.length < 1 || s.items.length > 30) out.push("Пунктов проверки — от 1 до 30");
  const titles = s.items.map((i) => i.trim());
  if (titles.some((t) => t.length < 1)) out.push("Пункт проверки не может быть пустым");
  if (titles.some((t) => t.length > 200)) out.push("Пункт проверки длиннее 200 символов");
  if (new Set(titles).size !== titles.length) out.push("Пункты проверки повторяются");
  return out;
}
