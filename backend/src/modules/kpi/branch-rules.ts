// Правила балла филиала (спека 7.7). Чистый модуль: без БД и Redis.
import type { Scope } from "./rules";
import { addMonths, type Period } from "./time";
import type {
  BranchDirection,
  BranchIndicator,
  BranchIndicatorCode,
  BranchSettings,
  NoDataReason,
  SanitaryItem,
} from "./types";

export const BRANCH_CODES: readonly BranchIndicatorCode[] = ["sales", "food_cost", "service", "sanitary", "discipline"];

export type Thresholds = { floor: number; target: number; max: number; direction: BranchDirection };

// Округление половины вверх без плавающих хвостов: 12 значащих цифр гасят 1833.4999999999998 → 1833.5
export const roundTo = (x: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(+(x * f).toPrecision(12)) / f;
};
const round2 = (x: number) => roundTo(x, 2);

// Доля в процентах до 0,01; знаменатель ≤ 0 — значения нет
export function pct2(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return round2((100 * part) / whole);
}

// Последний день месяца периода
export function monthLastDay(p: Period): string {
  const next = addMonths(p, 1);
  const t = Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1) - 24 * 3600 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

// Шкала 7.7: на пороге и ниже 0; порог..цель 50..100; цель..максимум 100..120; выше максимума 120
export function indicatorPoints(t: Thresholds, fact: number): number {
  if (!Number.isFinite(fact)) throw new RangeError("indicatorPoints: факт не число");
  // lower_better зеркалим знаком: порядок порогов становится как у higher_better
  const s = t.direction === "lower_better" ? -1 : 1;
  const f = s * fact, floor = s * t.floor, target = s * t.target, max = s * t.max;
  if (f <= floor) return 0;
  if (f < target) return round2(50 + ((f - floor) / (target - floor)) * 50);
  if (f < max) return round2(100 + ((f - target) / (max - target)) * 20);
  return 120;
}

export type FactResult = { fact: number | null; reason: NoDataReason | null; details: Record<string, number | null> };

export type TerminalInputs = {
  has_iiko: boolean;
  has_store: boolean;
  revenue: number;
  plan: number | null;
  recons: { status: string; diff_bc: number | null }[];
  // Сколько складов привязано к филиалу; нет в записи — столько, сколько строк сверок
  stores_total?: number;
  service: { orders: number; on_time: number; hall_min: number; delivery_min: number };
  sanitary: { checks: number; avg: number | null };
  attendance: { days: number; on_time: number; late: number; absent: number };
};

const noData = (reason: NoDataReason, details: Record<string, number | null> = {}): FactResult => ({ fact: null, reason, details });
const value = (fact: number | null, reason: NoDataReason, details: Record<string, number | null>): FactResult =>
  fact === null ? noData(reason, details) : { fact, reason: null, details };

export function terminalFacts(x: TerminalInputs): Record<BranchIndicatorCode, FactResult> {
  // Продажи
  const salesDetails = { revenue: x.revenue, plan: x.plan };
  let sales: FactResult;
  if (!x.has_iiko) sales = noData("no_iiko_link", salesDetails);
  else if (x.plan === null || !(x.plan > 0)) sales = noData("no_plan", salesDetails);
  else if (!(x.revenue > 0)) sales = noData("no_orders", salesDetails);
  else sales = value(pct2(x.revenue, x.plan), "no_plan", salesDetails);

  // Перерасход сырья: чистая недостача по принятым сверкам к выручке.
  // Принята должна быть сверка каждого привязанного склада; склад без строки сверки считается непринятым.
  let food_cost: FactResult;
  const storesTotal = Math.max(x.stores_total ?? x.recons.length, x.recons.length);
  const storesReconciled = x.recons.filter((r) => r.status === "accepted").length;
  const sd = { stores_total: storesTotal, stores_reconciled: storesReconciled };
  if (!x.has_store) food_cost = noData("no_store");
  else if (x.recons.length === 0) food_cost = noData("no_reconciliation", sd);
  else if (storesReconciled < storesTotal) food_cost = noData("not_accepted", sd);
  else if (x.recons.some((r) => r.diff_bc === null)) food_cost = noData("no_iiko_document", sd);
  else {
    const sum = x.recons.reduce((a, r) => a + (r.diff_bc as number), 0);
    const details = { revenue: x.revenue, overspend: Math.max(0, round2(-sum)), ...sd };
    if (!x.has_iiko) food_cost = noData("no_iiko_link", details);
    else if (!(x.revenue > 0)) food_cost = noData("no_orders", details);
    else food_cost = value(pct2(details.overspend, x.revenue), "no_orders", details);
  }

  // Заказы в норматив
  const sv = x.service;
  const svDetails = { orders: sv.orders, on_time: sv.on_time, hall_min: sv.hall_min, delivery_min: sv.delivery_min };
  let service: FactResult;
  if (!x.has_iiko) service = noData("no_iiko_link", svDetails);
  else if (sv.orders === 0) service = noData("no_cooking_rows", svDetails);
  else service = value(pct2(sv.on_time, sv.orders), "no_cooking_rows", svDetails);

  // Санитария
  const sanitary: FactResult =
    x.sanitary.checks === 0 || x.sanitary.avg === null || !Number.isFinite(x.sanitary.avg)
      ? noData("no_checks", { checks: x.sanitary.checks })
      : { fact: round2(x.sanitary.avg), reason: null, details: { checks: x.sanitary.checks } };

  // Дисциплина
  const a = x.attendance;
  const aDetails = { days: a.days, on_time: a.on_time, late: a.late, absent: a.absent };
  const discipline: FactResult = a.days === 0 ? noData("no_attendance", aDetails) : value(pct2(a.on_time, a.days), "no_attendance", aDetails);

  return { sales, food_cost, service, sanitary, discipline };
}

export type ScoredRow = FactResult & { code: BranchIndicatorCode; points: number | null; weighted: number | null; data_status: "ok" | "no_data" };

// Только активные показатели, по sort. Веса показателей без данных выпадают, остальные пересчитываются.
export function scoreTerminal(
  indicators: BranchIndicator[],
  facts: Record<BranchIndicatorCode, FactResult>,
): { rows: ScoredRow[]; score: number | null; tier_pct: number | null } {
  const active = indicators.filter((i) => i.active).sort((a, b) => a.sort - b.sort);
  const pts = active.map((i) => {
    const f = facts[i.code];
    // Нечисловой факт (NaN, Infinity) — это «нет данных», а не 120 баллов
    const usable = f.fact !== null && Number.isFinite(f.fact);
    return { i, f: usable || f.fact === null ? f : { ...f, fact: null, reason: "not_computed" as const }, points: usable ? indicatorPoints(i, f.fact as number) : null };
  });
  const sumW = pts.reduce((a, p) => (p.points === null ? a : a + p.i.weight), 0);
  let total = 0;
  const rows: ScoredRow[] = pts.map(({ i, f, points }) => {
    if (points === null || sumW <= 0) {
      return { ...f, code: i.code, points: null, weighted: null, data_status: "no_data" as const };
    }
    // Целая арифметика: баллы до 0,1, вклад в сотых, половина вверх
    const p10 = Math.round(+(points * 10).toPrecision(12));
    const n = p10 * i.weight * 10;
    const hundredths = Math.floor((2 * n + sumW) / (2 * sumW));
    total += hundredths;
    return { ...f, code: i.code, points, weighted: hundredths / 100, data_status: "ok" as const };
  });
  if (!rows.some((r) => r.data_status === "ok")) return { rows, score: null, tier_pct: null };
  const score = total / 100;
  return { rows, score, tier_pct: tierFor(score) };
}

// Ступени: 75 → 60 %, 90 → 100 %, 105 → 120 %
const TIERS: { min: number; pct: number }[] = [
  { min: 75, pct: 60 },
  { min: 90, pct: 100 },
  { min: 105, pct: 120 },
];

export function tierFor(score: number): number {
  let pct = 0;
  for (const t of TIERS) if (score >= t.min) pct = t.pct;
  return pct;
}

export function nextTier(score: number): { tier_pct: number; points_needed: number } | null {
  const t = TIERS.find((x) => score < x.min);
  if (!t) return null;
  return { tier_pct: t.pct, points_needed: Math.max(0.1, roundTo(t.min - score, 1)) };
}

export function disciplineMultiplier(lateCount: number): number {
  if (lateCount <= 0) return 1;
  if (lateCount <= 2) return 0.9;
  if (lateCount <= 4) return 0.75;
  return 0.5;
}

// Премия в целых сум (базовых премий в API нет, функция только для расчёта и теста)
export function branchBonus(base: number, tierPct: number, lateCount: number): number {
  return Math.round(((base * tierPct) / 100) * disciplineMultiplier(lateCount));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateIndicators(
  input: unknown,
  current: BranchIndicator[],
): { ok: BranchIndicator[] } | { error: string; extra: Record<string, unknown> } {
  const bad = (error: string, extra: Record<string, unknown> = {}) => ({ error, extra });
  if (!Array.isArray(input) || input.length !== BRANCH_CODES.length) return bad("unknown_indicator");
  const seen = new Set<string>();
  for (const it of input) {
    if (!isObj(it) || typeof it.code !== "string" || !(BRANCH_CODES as readonly string[]).includes(it.code) || seen.has(it.code)) {
      return bad("unknown_indicator");
    }
    seen.add(it.code);
  }
  const out: BranchIndicator[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const code = raw.code as BranchIndicatorCode;
    const cur = current.find((c) => c.code === code);
    if (!cur) return bad("unknown_indicator");
    const { weight, active, floor, target, max } = raw;
    if (typeof active !== "boolean" || typeof weight !== "number" || !Number.isInteger(weight) || weight < 0 || weight > 100 || (active && weight === 0)) {
      return bad("bad_indicator_weight", { code });
    }
    if (!finite(floor) || !finite(target) || !finite(max)) return bad("bad_thresholds", { code });
    const ordered = cur.direction === "higher_better" ? floor < target && target < max : floor > target && target > max;
    if (!ordered) return bad("bad_thresholds", { code });
    out.push({ ...cur, weight, floor, target, max, active });
  }
  const sum = out.reduce((a, i) => (i.active ? a + i.weight : a), 0);
  if (sum !== 100) return bad("weights_sum", { sum });
  return { ok: out.sort((a, b) => a.sort - b.sort) };
}

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  service_norm_hall_min: 8,
  service_norm_delivery_min: 12,
  sanitary_items: ["Чистота", "Санитария", "Форма персонала", "Хранение продуктов", "Маркировка"],
};

export function validateBranchSettingsPatch(p: Record<string, unknown>): string | null {
  const keys = Object.keys(p);
  if (keys.some((k) => !Object.prototype.hasOwnProperty.call(DEFAULT_BRANCH_SETTINGS, k))) return "unknown_setting";
  for (const k of keys) {
    const v = p[k];
    if (k === "sanitary_items") {
      if (!Array.isArray(v) || v.length < 1 || v.length > 30) return "bad_sanitary_items";
      const titles: string[] = [];
      for (const s of v) {
        if (typeof s !== "string") return "bad_sanitary_items";
        const t = s.trim();
        if (t.length < 1 || t.length > 200) return "bad_sanitary_items";
        titles.push(t);
      }
      if (new Set(titles).size !== titles.length) return "bad_sanitary_items";
    } else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 120) {
      return "bad_value";
    }
  }
  return null;
}

// Назначение с этим филиалом или без филиала; карта любая
export function coversTerminal(scopes: Scope[], terminalId: string): boolean {
  return scopes.some((s) => s.terminal_id === null || s.terminal_id === terminalId);
}

export function parseSanitaryItems(v: unknown): SanitaryItem[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) return null;
  const out: SanitaryItem[] = [];
  for (const it of v) {
    if (!isObj(it) || typeof it.title !== "string" || typeof it.ok !== "boolean") return null;
    const title = it.title.trim();
    if (title.length < 1 || title.length > 200) return null;
    out.push({ title, ok: it.ok });
  }
  return out;
}

export function sanitaryPct(items: SanitaryItem[]): number {
  if (items.length === 0) return 0;
  return round2((100 * items.filter((i) => i.ok).length) / items.length);
}

export type BranchSource = "sales_plan" | "food_cost" | "cooking_speed";
export const BRANCH_SOURCE_INDICATOR: Record<BranchSource, BranchIndicatorCode> = {
  sales_plan: "sales",
  food_cost: "food_cost",
  cooking_speed: "service",
};

const BASIS: Record<BranchSource, (fact: string, points: string) => string> = {
  sales_plan: (f, p) => `Филиал: продажи ${f}% плана → ${p} балла`,
  food_cost: (f, p) => `Филиал: перерасход сырья ${f}% выручки → ${p} балла`,
  cooking_speed: (f, p) => `Филиал: заказов в норматив ${f}% → ${p} балла`,
};

// Факт до 0,01 с запятой без хвостовых нулей; баллы с одним знаком
const fmtFact = (x: number) => String(parseFloat(x.toFixed(2))).replace(".", ",");
const fmtPoints = (x: number) => roundTo(x, 1).toFixed(1).replace(".", ",");

export function branchSuggestion(source: BranchSource, r: { fact: number; points: number }): { score: number; basis: string } {
  return { score: Math.min(100, Math.round(r.points)), basis: BASIS[source](fmtFact(r.fact), fmtPoints(r.points)) };
}

// План от выручки прошлого года: рост в процентах, округление до 1 000 сум
export function planSuggestion(baseRevenue: number | null, growthPct: number): number | null {
  if (baseRevenue === null || !(baseRevenue > 0)) return null;
  const v = Math.round(roundTo((baseRevenue * (100 + growthPct)) / 100 / 1000, 6)) * 1000;
  return v > 0 ? v : null;
}
