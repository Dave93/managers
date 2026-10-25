// Чистые правила KPI: процент оценки, карта сотрудника, назначения, шкала повышения, настройки.
export type ItemSource = "manual" | "attendance" | "cooking_speed" | "sales_plan" | "food_cost";
export const ITEM_SOURCES: ItemSource[] = ["manual", "attendance", "cooking_speed", "sales_plan", "food_cost"];

export type ScoredItem = { item_id: string; weight: number; source: ItemSource; score: number | null };

const round2 = (x: number) => Math.round(x * 100) / 100;

// Σ(score×weight)/Σweight по пунктам с оценкой; пустые выпадают
export function scorePct(items: ScoredItem[]): number | null {
  let sum = 0;
  let w = 0;
  for (const i of items) {
    if (i.score === null) continue;
    sum += i.score * i.weight;
    w += i.weight;
  }
  if (w <= 0) return null;
  return round2(sum / w);
}

// Ручные пункты без оценки
export function missingManual(items: ScoredItem[]): string[] {
  return items.filter((i) => i.source === "manual" && i.score === null).map((i) => i.item_id);
}

// Целое 0..100
export function isScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;
}

// Строка, букв и цифр не меньше min: пробелы, пунктуация и невидимые символы не считаются
export function commentOk(c: unknown, min: number): boolean {
  if (typeof c !== "string") return false;
  return (c.match(/[\p{L}\p{N}]/gu) ?? []).length >= min;
}

export function violationHint(count: number, penalty: number): number {
  return Math.max(0, 100 - penalty * count);
}

export type CardLite = { id: string; staff_role_codes: string[]; active: boolean; sort: number };

// Карта сотрудника: ручное назначение > стажёр без карты > первая активная карта по sort
export function effectiveCardId(
  emp: { staff_role_code: string | null; is_trainee: boolean | null },
  override: { card_id: string | null } | undefined,
  cards: CardLite[],
): { card_id: string | null; source: "override" | "role" | null } {
  if (override) return { card_id: override.card_id, source: "override" };
  if (emp.is_trainee === true || !emp.staff_role_code) return { card_id: null, source: null };
  const code = emp.staff_role_code;
  const found = cards
    .filter((c) => c.active && c.staff_role_codes.includes(code))
    .sort((a, b) => a.sort - b.sort)[0];
  return found ? { card_id: found.id, source: "role" } : { card_id: null, source: null };
}

export type Scope = { card_id: string | null; terminal_id: string | null };

// null в назначении — «любой»; цель без карты подходит только назначениям с card_id = null
export function scopeCovers(scopes: Scope[], target: { card_id: string | null; terminal_id: string }): boolean {
  return scopes.some(
    (s) =>
      (s.card_id === null || s.card_id === target.card_id) &&
      (s.terminal_id === null || s.terminal_id === target.terminal_id),
  );
}

export type Tier = { min_pct: number; amount: number };

// Первый найденный код ошибки или null
export function validateTiers(tiers: Tier[], cap: number): string | null {
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (tiers.some((t) => !num(t.min_pct) || t.min_pct < 0 || t.min_pct > 100)) return "tier_pct_range";
  if (tiers.some((t) => !num(t.amount) || t.amount < 0)) return "tier_amount_range";
  if (tiers.some((t) => t.amount > cap)) return "tier_amount_over_cap";
  if (new Set(tiers.map((t) => t.min_pct)).size !== tiers.length) return "tier_pct_duplicate";
  return null;
}

// Сумма высшей ступени, до которой дотягивает средний процент
export function raiseFor(avg: number, tiers: Tier[]): number {
  const t = [...tiers].sort((a, b) => b.min_pct - a.min_pct).find((x) => avg >= x.min_pct);
  return t ? t.amount : 0;
}

export function quarterRow(
  months: (number | null)[],
  tiers: Tier[],
  minMonths: number,
): { months_scored: number; avg_pct: number | null; status: "proposed" | "insufficient"; suggested_amount: number } {
  const scored = months.filter((m): m is number => m !== null);
  const avg = scored.length ? round2(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  if (avg === null || scored.length < minMonths) {
    return { months_scored: scored.length, avg_pct: avg, status: "insufficient", suggested_amount: 0 };
  }
  return { months_scored: scored.length, avg_pct: avg, status: "proposed", suggested_amount: raiseFor(avg, tiers) };
}

// Только изменившиеся пункты
export function diffScores(
  before: Record<string, number | null>,
  after: Record<string, number | null>,
): { item_id: string; old: number | null; new: number | null }[] {
  const ids = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  const out: { item_id: string; old: number | null; new: number | null }[] = [];
  for (const id of ids) {
    const o = before[id] ?? null;
    const n = after[id] ?? null;
    if (o !== n) out.push({ item_id: id, old: o, new: n });
  }
  return out;
}

export interface KpiSettings {
  review_deadline_day: number;
  dispute_deadline_day: number;
  reminder_days_before: number;
  raise_cap: number;
  raise_min_months: number;
  violation_photo_required: boolean;
  violation_penalty_hint: number;
  change_comment_min: number;
}

export const DEFAULT_SETTINGS: KpiSettings = {
  review_deadline_day: 7,
  dispute_deadline_day: 10,
  reminder_days_before: 7,
  raise_cap: 500000,
  raise_min_months: 2,
  violation_photo_required: false,
  violation_penalty_hint: 10,
  change_comment_min: 5,
};

const DAY_KEYS = ["review_deadline_day", "dispute_deadline_day"];
const RANGES: Record<string, [number, number]> = {
  reminder_days_before: [0, 27],
  raise_cap: [0, 10_000_000],
  raise_min_months: [1, 3],
  violation_penalty_hint: [0, 100],
  change_comment_min: [1, 200],
};
const BOOL_KEYS = ["violation_photo_required"];

const inRange = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

// Проверяет объект как есть; для dispute_before_review вызывающий передаёт объединённые настройки
export function validateSettingsPatch(patch: Record<string, unknown>): string | null {
  const known = new Set([...Object.keys(DEFAULT_SETTINGS)]);
  for (const k of Object.keys(patch)) if (!known.has(k)) return "unknown_setting";
  for (const [k, v] of Object.entries(patch)) {
    if (DAY_KEYS.includes(k)) {
      if (!inRange(v, 1, 28)) return "bad_day";
    } else if (BOOL_KEYS.includes(k)) {
      if (typeof v !== "boolean") return "bad_value";
    } else {
      const [lo, hi] = RANGES[k];
      if (!inRange(v, lo, hi)) return "bad_value";
    }
  }
  if ("review_deadline_day" in patch && "dispute_deadline_day" in patch) {
    if ((patch.dispute_deadline_day as number) < (patch.review_deadline_day as number)) return "dispute_before_review";
  }
  return null;
}

// Балл, отличный от предложения, требует заметки; без предложения заметка не нужна.
export function noteRequired(
  suggestion: { score: number } | null,
  score: number | null,
  note: string | null | undefined,
): boolean {
  if (!suggestion || score === null || score === suggestion.score) return false;
  return (note ?? "").trim() === "";
}
