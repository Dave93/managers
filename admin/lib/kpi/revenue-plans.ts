// План выручки филиалов: месяцы, черновик таблицы, подсказка «от прошлого года».
import type { RevenuePlanItem, RevenuePlanRow, RevenueSuggestRow } from "@admin/lib/kpi-api";
import { parseDecimal } from "./branch";
import { formatSum, parseAmount } from "./format";
import { ruT, type KpiT } from "./i18n";
import { addMonths, calendarPeriod } from "./periods";

const MAX_AMOUNT = 1_000_000_000_000;

/** Текущий месяц, два вперёд и одиннадцать назад; сверху самый поздний. */
export function planPeriods(now: Date): string[] {
  const cur = calendarPeriod(now);
  return Array.from({ length: 14 }, (_, i) => addMonths(cur, 2 - i));
}

/** Поля таблицы по филиалам: terminal_id → текст суммы. */
export type PlanDraft = Record<string, string>;

export function planDraft(rows: readonly RevenuePlanRow[]): PlanDraft {
  return Object.fromEntries(rows.map((r) => [r.terminal_id, r.amount === null ? "" : String(r.amount)]));
}

/**
 * Подсказка от прошлого года. "empty" («Заполнить») пишет только в пустые поля, заполненные оставляет (kept);
 * "all" («Заменить все») переписывает каждое поле. Филиалы без выручки прошлого года не трогаются ни в каком режиме.
 */
export function applySuggestions(
  draft: PlanDraft,
  rows: readonly RevenueSuggestRow[],
  mode: "empty" | "all" = "empty",
): { draft: PlanDraft; filled: number; missing: number; kept: number } {
  const next: PlanDraft = { ...draft };
  let filled = 0;
  let missing = 0;
  let kept = 0;
  for (const r of rows) {
    if (!Object.hasOwn(draft, r.terminal_id)) continue;
    if (mode === "empty" && draft[r.terminal_id].trim() !== "") kept++;
    else if (r.suggested === null) missing++;
    else {
      next[r.terminal_id] = String(r.suggested);
      filled++;
    }
  }
  return { draft: next, filled, missing, kept };
}

export function suggestSummary(r: { filled: number; missing: number; kept: number }, t: KpiT = ruT): string {
  const s = t("lib.revenuePlans.suggest", { filled: r.filled, missing: r.missing });
  return r.kept > 0 ? t("lib.revenuePlans.suggestKept", { base: s, kept: r.kept }) : s;
}

/** Что отправить: только изменённые строки; пустое поле при прежнем плане удаляет план. */
export function planChanges(draft: PlanDraft, rows: readonly RevenuePlanRow[], t: KpiT = ruT): { items: RevenuePlanItem[]; errors: string[] } {
  const items: RevenuePlanItem[] = [];
  const errors: string[] = [];
  for (const r of rows) {
    const text = draft[r.terminal_id];
    if (text === undefined) continue;
    const name = r.terminal_name ?? t("lib.revenuePlans.branch");
    if (text.trim() === "") {
      if (r.amount !== null) items.push({ terminal_id: r.terminal_id, amount: null });
      continue;
    }
    const amount = parseAmount(text);
    if (amount === null || amount === 0) errors.push(t("lib.revenuePlans.planInt", { name }));
    else if (amount > MAX_AMOUNT) errors.push(t("lib.revenuePlans.planMax", { name, max: formatSum(MAX_AMOUNT, t) }));
    else if (amount !== r.amount) items.push({ terminal_id: r.terminal_id, amount });
  }
  return { items, errors };
}

/** Рост к прошлому году в процентах: от −50 до 200, иначе null. */
export function parseGrowth(s: string): number | null {
  const n = parseDecimal(s);
  return n !== null && n >= -50 && n <= 200 ? n : null;
}
