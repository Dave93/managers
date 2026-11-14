// Ведомость на выдачу бонусов KPI за квартал: лист на компанию, печатается до решений и подписывается CEO.
// Спека: docs/superpowers/specs/2026-11-14-kpi-bonus-statement-design.md
import { raiseFor, type Tier } from "./rules";
import type { RaiseRow } from "./types";

export type CeoCell = number | "отказ" | null;

export interface StatementLine {
  no: string; // порядковый номер; «*» — строку нужно пересчитать
  employee_name: string;
  terminal_name: string | null;
  card_title: string | null;
  months: (number | null)[];
  avg_pct: number | null;
  suggested_amount: number;
  ceo: CeoCell;
}

export interface StatementInfoLine {
  employee_name: string;
  terminal_name: string | null;
  avg_pct: number | null;
  reason: string;
}

export interface StatementSheet {
  sheet_name: string;
  company: string;
  lines: StatementLine[];
  total_count: number;
  total_suggested: number;
  info: StatementInfoLine[];
  warnings: string[];
}

export const NO_COMPANY = "Без компании";
export const WARN_OPEN = "Предварительно: месяцы квартала ещё не закрыты, суммы могут измениться";
export const WARN_STALE = "Оценки менялись после расчёта. Нажмите «Пересчитать» и выгрузите заново";
export const WARN_TIERS = "Шкала бонусов менялась после расчёта. Нажмите «Пересчитать» и выгрузите заново";

// 300000 → «300 000»
export const groupDigits = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const isDecided = (r: RaiseRow) => r.status === "approved" || r.status === "rejected";
const refused = (r: RaiseRow) => r.status === "rejected" || (r.status === "approved" && !(Number(r.approved_amount) > 0));

// Нерешённая строка, у которой сумма по текущей шкале не совпадает с расчётной: шкалу меняли после «Пересчитать».
// Строки с недобором месяцев не проверяем: им по правилам 0 при любой шкале.
function tiersChanged(r: RaiseRow, tiers: Tier[], minMonths: number): boolean {
  if (isDecided(r) || r.avg_pct === null || r.months_scored < minMonths) return false;
  return raiseFor(r.avg_pct, tiers) !== r.suggested_amount;
}

function sheetName(company: string): string {
  return company.replace(/[[\]:*?/\\]/g, "").slice(0, 31) || NO_COMPANY;
}

function byBranchThenName(a: RaiseRow, b: RaiseRow): number {
  if (a.terminal_name !== b.terminal_name) {
    if (a.terminal_name === null) return 1;
    if (b.terminal_name === null) return -1;
    const t = a.terminal_name.localeCompare(b.terminal_name, "ru");
    if (t !== 0) return t;
  }
  return a.employee_name.localeCompare(b.employee_name, "ru") || a.id.localeCompare(b.id);
}

function reason(r: RaiseRow, tiers: Tier[], minMonths: number): string {
  let base: string;
  if (r.months_scored < minMonths) base = `мало оценок: ${r.months_scored} из ${minMonths} нужных`;
  else if (tiers.length === 0) base = "шкала не задана";
  else base = `ниже порога ${Math.min(...tiers.map((t) => t.min_pct))} %`;
  if (!isDecided(r)) return base;
  return refused(r) ? `${base}, решение HR: отказ` : `${base}, решение HR: ${groupDigits(Number(r.approved_amount))} сум`;
}

function sheetOf(company: string, rows: RaiseRow[], tiers: Tier[], minMonths: number): StatementSheet {
  const sorted = [...rows].sort(byBranchThenName);
  const paid = (r: RaiseRow) => r.suggested_amount > 0 || (r.status === "approved" && Number(r.approved_amount) > 0);
  const main = sorted.filter(paid);
  const lines = main.map((r, i): StatementLine => ({
    no: `${i + 1}${r.stale || tiersChanged(r, tiers, minMonths) ? "*" : ""}`,
    employee_name: r.employee_name,
    terminal_name: r.terminal_name,
    card_title: r.card_title,
    months: r.months.map((m) => m.score_pct),
    avg_pct: r.avg_pct,
    suggested_amount: r.suggested_amount,
    ceo: !isDecided(r) ? null : refused(r) ? "отказ" : Number(r.approved_amount),
  }));
  const warnings: string[] = [];
  if (rows.some((r) => !r.periods_closed)) warnings.push(WARN_OPEN);
  if (rows.some((r) => r.stale)) warnings.push(WARN_STALE);
  if (rows.some((r) => tiersChanged(r, tiers, minMonths))) warnings.push(WARN_TIERS);
  return {
    sheet_name: sheetName(company),
    company,
    lines,
    total_count: lines.length,
    total_suggested: main.reduce((a, r) => a + r.suggested_amount, 0),
    info: sorted
      .filter((r) => !paid(r))
      .map((r) => ({ employee_name: r.employee_name, terminal_name: r.terminal_name, avg_pct: r.avg_pct, reason: reason(r, tiers, minMonths) })),
    warnings,
  };
}

// Лист на компанию (по имени), «Без компании» последним. Пустой вход — пустой список.
export function buildStatement(rows: RaiseRow[], tiers: Tier[], minMonths: number): StatementSheet[] {
  const groups = new Map<string | null, { company: string; rows: RaiseRow[] }>();
  for (const r of rows) {
    const key = r.organization_id;
    const g = groups.get(key) ?? { company: key === null ? NO_COMPANY : (r.organization_name ?? NO_COMPANY), rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .sort(([ka, a], [kb, b]) => (ka === null ? 1 : kb === null ? -1 : a.company.localeCompare(b.company, "ru")))
    .map(([, g]) => sheetOf(g.company, g.rows, tiers, minMonths));
}
