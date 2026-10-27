// Настройки KPI: карты, пункты, ручное назначение карты сотруднику.
import type { EmployeeRow, ItemSource, KpiSettings, ScopeRow, Tier } from "@admin/lib/kpi-api";
import { formatSum, parseAmount } from "./format";
import { SOURCE_LABEL } from "./status";

/** Коды ролей из текста: разделители — запятая, пробел, перевод строки; lower-case, без повторов. */
export function parseRoleCodes(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    const code = part.trim().toLowerCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Как на сервере для новой карты (varchar(40) в плане 1). */
export function cardCodeOk(code: string): boolean {
  return /^[a-z][a-z0-9_]{1,39}$/.test(code);
}

const SOURCE_ORDER: ItemSource[] = ["manual", "attendance", "cooking_speed", "sales_plan", "food_cost"];

/** Данные подтягиваются у всех источников: Workly (план 3), план, себестоимость и скорость из балла филиала (план 5). */
export const ITEM_SOURCE_OPTIONS: { value: ItemSource; label: string; ready: boolean }[] = SOURCE_ORDER.map((value) => ({
  value,
  label: SOURCE_LABEL[value],
  ready: true,
}));

/** Табельный номер из поля ввода: без пробелов по краям, пусто → null (снять номер). */
export function externalIdValue(text: string): string | null {
  const v = text.trim();
  return v === "" ? null : v;
}

export function externalIdIssue(text: string): string | null {
  return text.trim().length > 100 ? "Табельный номер — не длиннее 100 символов" : null;
}

export type AssignValue = "auto" | "none" | string;

export function assignValue(r: Pick<EmployeeRow, "card" | "card_source">): AssignValue {
  if (r.card_source !== "override") return "auto";
  return r.card ? r.card.id : "none";
}

export function assignBody(v: AssignValue): string | null | "auto" {
  return v === "none" ? null : v;
}

export function cardAssignLabel(r: Pick<EmployeeRow, "card" | "card_source">): string {
  if (r.card_source === "override") return r.card ? `Вручную: ${r.card.title_ru}` : "Не оценивается";
  if (r.card) return `По должности: ${r.card.title_ru}`;
  return "Нет карты";
}

// Шкала повышения.

export type TierDraft = { min_pct: string; amount: string };

/** Черновик шкалы → ступени по убыванию порога; первая найденная ошибка — текстом. */
export function tiersFromDraft(rows: readonly TierDraft[], cap: number): { tiers: Tier[] } | { error: string } {
  const tiers: Tier[] = [];
  for (const row of rows) {
    const raw = row.min_pct.trim();
    const pct = /^\d{1,3}([.,]\d{1,2})?$/.test(raw) ? Number(raw.replace(",", ".")) : NaN;
    if (!(pct >= 0 && pct <= 100)) return { error: "Порог ступени — число от 0 до 100" };
    const amount = parseAmount(row.amount);
    if (amount === null) return { error: "Сумма ступени — целое число сум, не меньше 0" };
    if (amount > cap) return { error: `Сумма ступени больше потолка повышения (${formatSum(cap)})` };
    tiers.push({ min_pct: pct, amount });
  }
  if (new Set(tiers.map((t) => t.min_pct)).size !== tiers.length) return { error: "Пороги ступеней не должны повторяться" };
  return { tiers: tiers.sort((a, b) => b.min_pct - a.min_pct) };
}

// Сроки и прочие настройки.

export type SettingsField = {
  key: keyof KpiSettings;
  label: string;
  kind: "int" | "bool";
  min?: number;
  max?: number;
  hint: string;
};

export const SETTINGS_FIELDS: SettingsField[] = [
  { key: "review_deadline_day", label: "Срок оценок, число следующего месяца", kind: "int", min: 1, max: 28, hint: "Оценки за месяц ставят до этого числа" },
  { key: "dispute_deadline_day", label: "Срок споров, число следующего месяца", kind: "int", min: 1, max: 28, hint: "До 23:59 этого дня по Ташкенту" },
  { key: "reminder_days_before", label: "Напоминать оценщикам за, дней", kind: "int", min: 0, max: 27, hint: "Напоминания отправляет Telegram-воркер (план 4)" },
  { key: "raise_cap", label: "Потолок повышения, сум", kind: "int", min: 0, max: 10_000_000, hint: "Ни одна ступень и ни одно решение не больше" },
  { key: "raise_min_months", label: "Минимум оценённых месяцев в квартале", kind: "int", min: 1, max: 3, hint: "Меньше — статус «Мало оценок»" },
  { key: "violation_photo_required", label: "Фото к нарушению обязательно", kind: "bool", hint: "" },
  { key: "violation_penalty_hint", label: "Подсказка: минус % за нарушение", kind: "int", min: 0, max: 100, hint: "Только подсказка в форме, сам балл ставит оценщик" },
  { key: "change_comment_min", label: "Минимальная длина комментария к изменению", kind: "int", min: 1, max: 200, hint: "Символов без пробелов" },
];

export function settingsIssues(s: KpiSettings): string[] {
  const issues: string[] = [];
  const inRange = (f: SettingsField) => {
    const v = s[f.key];
    return typeof v === "number" && Number.isInteger(v) && v >= (f.min as number) && v <= (f.max as number);
  };
  for (const f of SETTINGS_FIELDS) {
    if (f.kind === "int" && !inRange(f)) issues.push(`${f.label}: от ${f.min} до ${f.max}`);
  }
  const days = SETTINGS_FIELDS.filter((f) => f.key === "review_deadline_day" || f.key === "dispute_deadline_day");
  if (days.every(inRange) && s.dispute_deadline_day < s.review_deadline_day) {
    issues.push("Срок споров не может быть раньше срока оценок");
  }
  return issues;
}

export function settingsPatch(before: KpiSettings, after: KpiSettings): Partial<KpiSettings> {
  const patch: Record<string, number | boolean> = {};
  for (const f of SETTINGS_FIELDS) {
    if (before[f.key] !== after[f.key]) patch[f.key] = after[f.key];
  }
  return patch as Partial<KpiSettings>;
}

export function scopeLabel(s: Pick<ScopeRow, "card_title" | "terminal_name">): string {
  return `${s.card_title ?? "Любая карта"} · ${s.terminal_name ?? "Любой филиал"}`;
}

/** Вес нового пункта: самый частый вес среди включённых пунктов карты (при равенстве — меньший), иначе 1.
 *  Все пункты весят одинаково, и новый не должен перевешивать остальные. */
export function defaultItemWeight(items: { weight: number; active: boolean }[]): number {
  const counts = new Map<number, number>();
  for (const i of items) if (i.active) counts.set(i.weight, (counts.get(i.weight) ?? 0) + 1);
  let best = 1;
  let bestN = 0;
  for (const [w, n] of counts) if (n > bestN || (n === bestN && w < best)) [best, bestN] = [w, n];
  return best;
}
