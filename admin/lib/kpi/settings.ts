// Настройки KPI: карты, пункты, ручное назначение карты сотруднику.
import type { EmployeeRow, ItemSource } from "@admin/lib/kpi-api";
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

/** Данные из источника пока подтягиваются только у ручного: остальные оцениваются вручную. */
export const ITEM_SOURCE_OPTIONS: { value: ItemSource; label: string; ready: boolean }[] = SOURCE_ORDER.map((value) => ({
  value,
  label: SOURCE_LABEL[value],
  ready: value === "manual",
}));

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
