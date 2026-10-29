// Настройки KPI: карты, пункты, ручное назначение карты сотруднику.
import type { EmployeeRow, ItemSource, KpiSettings, ScopeRow, Tier } from "@admin/lib/kpi-api";
import { formatSum, parseAmount } from "./format";
import { ruT, type KpiT } from "./i18n";
import { SOURCE_LABEL, SOURCE_LABEL_KEY } from "./status";

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
export const ITEM_SOURCE_OPTIONS: { value: ItemSource; label: string; labelKey: string; ready: boolean }[] = SOURCE_ORDER.map((value) => ({
  value,
  label: SOURCE_LABEL[value],
  labelKey: SOURCE_LABEL_KEY[value],
  ready: true,
}));

/** Табельный номер из поля ввода: без пробелов по краям, пусто → null (снять номер). */
export function externalIdValue(text: string): string | null {
  const v = text.trim();
  return v === "" ? null : v;
}

export function externalIdIssue(text: string, t: KpiT = ruT): string | null {
  return text.trim().length > 100 ? t("lib.settings.externalIdLong") : null;
}

export type AssignValue = "auto" | "none" | string;

export function assignValue(r: Pick<EmployeeRow, "card" | "card_source">): AssignValue {
  if (r.card_source !== "override") return "auto";
  return r.card ? r.card.id : "none";
}

export function assignBody(v: AssignValue): string | null | "auto" {
  return v === "none" ? null : v;
}

export function cardAssignLabel(r: Pick<EmployeeRow, "card" | "card_source">, t: KpiT = ruT): string {
  if (r.card_source === "override") return r.card ? t("lib.settings.cardManual", { title: r.card.title_ru }) : t("lib.settings.notEvaluated");
  if (r.card) return t("lib.settings.cardPosition", { title: r.card.title_ru });
  return t("lib.settings.cardNone");
}

// Шкала повышения.

export type TierDraft = { min_pct: string; amount: string };

/** Черновик шкалы → ступени по убыванию порога; первая найденная ошибка — текстом. */
export function tiersFromDraft(rows: readonly TierDraft[], cap: number, t: KpiT = ruT): { tiers: Tier[] } | { error: string } {
  const tiers: Tier[] = [];
  for (const row of rows) {
    const raw = row.min_pct.trim();
    const pct = /^\d{1,3}([.,]\d{1,2})?$/.test(raw) ? Number(raw.replace(",", ".")) : NaN;
    if (!(pct >= 0 && pct <= 100)) return { error: t("lib.settings.tierPct") };
    const amount = parseAmount(row.amount);
    if (amount === null) return { error: t("lib.settings.tierAmount") };
    if (amount > cap) return { error: t("lib.settings.tierOverCap", { cap: formatSum(cap, t) }) };
    tiers.push({ min_pct: pct, amount });
  }
  if (new Set(tiers.map((t) => t.min_pct)).size !== tiers.length) return { error: t("lib.settings.tierDuplicate") };
  return { tiers: tiers.sort((a, b) => b.min_pct - a.min_pct) };
}

// Сроки и прочие настройки.

/** label/hint — русский запасной текст; в интерфейсе переводите `t(labelKey)` и `hintKey && t(hintKey)`. */
export type SettingsField = {
  key: keyof KpiSettings;
  label: string;
  labelKey: string;
  hintKey: string;
  kind: "int" | "bool";
  min?: number;
  max?: number;
  hint: string;
};

export const SETTINGS_FIELDS: SettingsField[] = [
  { key: "review_deadline_day", label: ruT("lib.settings.field.review_deadline_day.label"), labelKey: "lib.settings.field.review_deadline_day.label", kind: "int", min: 1, max: 28, hint: ruT("lib.settings.field.review_deadline_day.hint"), hintKey: "lib.settings.field.review_deadline_day.hint" },
  { key: "dispute_deadline_day", label: ruT("lib.settings.field.dispute_deadline_day.label"), labelKey: "lib.settings.field.dispute_deadline_day.label", kind: "int", min: 1, max: 28, hint: ruT("lib.settings.field.dispute_deadline_day.hint"), hintKey: "lib.settings.field.dispute_deadline_day.hint" },
  { key: "reminder_days_before", label: ruT("lib.settings.field.reminder_days_before.label"), labelKey: "lib.settings.field.reminder_days_before.label", kind: "int", min: 0, max: 27, hint: ruT("lib.settings.field.reminder_days_before.hint"), hintKey: "lib.settings.field.reminder_days_before.hint" },
  { key: "raise_cap", label: ruT("lib.settings.field.raise_cap.label"), labelKey: "lib.settings.field.raise_cap.label", kind: "int", min: 0, max: 10_000_000, hint: ruT("lib.settings.field.raise_cap.hint"), hintKey: "lib.settings.field.raise_cap.hint" },
  { key: "raise_min_months", label: ruT("lib.settings.field.raise_min_months.label"), labelKey: "lib.settings.field.raise_min_months.label", kind: "int", min: 1, max: 3, hint: ruT("lib.settings.field.raise_min_months.hint"), hintKey: "lib.settings.field.raise_min_months.hint" },
  { key: "violation_photo_required", label: ruT("lib.settings.field.violation_photo_required.label"), labelKey: "lib.settings.field.violation_photo_required.label", kind: "bool", hint: "", hintKey: "" },
  { key: "violation_penalty_hint", label: ruT("lib.settings.field.violation_penalty_hint.label"), labelKey: "lib.settings.field.violation_penalty_hint.label", kind: "int", min: 0, max: 100, hint: ruT("lib.settings.field.violation_penalty_hint.hint"), hintKey: "lib.settings.field.violation_penalty_hint.hint" },
  { key: "change_comment_min", label: ruT("lib.settings.field.change_comment_min.label"), labelKey: "lib.settings.field.change_comment_min.label", kind: "int", min: 1, max: 200, hint: ruT("lib.settings.field.change_comment_min.hint"), hintKey: "lib.settings.field.change_comment_min.hint" },
];

export function settingsIssues(s: KpiSettings, t: KpiT = ruT): string[] {
  const issues: string[] = [];
  const inRange = (f: SettingsField) => {
    const v = s[f.key];
    return typeof v === "number" && Number.isInteger(v) && v >= (f.min as number) && v <= (f.max as number);
  };
  for (const f of SETTINGS_FIELDS) {
    if (f.kind === "int" && !inRange(f)) issues.push(t("lib.settings.fieldRange", { label: t(f.labelKey), min: f.min as number, max: f.max as number }));
  }
  const days = SETTINGS_FIELDS.filter((f) => f.key === "review_deadline_day" || f.key === "dispute_deadline_day");
  if (days.every(inRange) && s.dispute_deadline_day < s.review_deadline_day) {
    issues.push(t("lib.settings.disputeBeforeReview"));
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

export function scopeLabel(s: Pick<ScopeRow, "card_title" | "terminal_name">, t: KpiT = ruT): string {
  return t("lib.settings.scope", { card: s.card_title ?? t("lib.settings.anyCard"), terminal: s.terminal_name ?? t("lib.settings.anyBranch") });
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
