// Ведомость на выдачу бонусов KPI за квартал: лист на компанию, печатается до решений и подписывается CEO.
// Спека: docs/superpowers/specs/2026-11-14-kpi-bonus-statement-design.md
import type { Font, Worksheet } from "exceljs";
import { raiseFor, type Tier } from "./rules";
import { quarterMonths, type Period } from "./time";
import { quarterLabel } from "./tg/messages";
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

// ---------- Excel ----------

const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const monthIdx = (p: Period) => Number(p.slice(5, 7)) - 1;
const COLS = 10;
const SUM_FMT = "# ##0";
const PCT_FMT = "0.00";
const THIN = { style: "thin" as const };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const EMPTY_TEXT = "За квартал нет расчёта. Нажмите «Пересчитать».";

function scaleLine(tiers: Tier[]): string {
  if (tiers.length === 0) return "Шкала: не задана";
  const parts = [...tiers].sort((a, b) => a.min_pct - b.min_pct).map((t) => `от ${t.min_pct} % — ${groupDigits(t.amount)}`);
  return `Шкала: ${parts.join(" · ")} сум`;
}

function drawSheet(ws: Worksheet, s: StatementSheet, tiers: Tier[], quarter: Period): void {
  const months = quarterMonths(quarter);
  ws.columns = [5, 28, 20, 22, 7, 7, 7, 10, 14, 18].map((width) => ({ width }));
  const text = (r: number, c: number, v: string, font: Partial<Font> = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.font = font;
    return cell;
  };

  text(1, 1, s.company, { bold: true, size: 12 });
  text(1, 8, "Утверждаю: ____________ CEO");
  ws.mergeCells(1, 8, 1, COLS);
  text(2, 1, "ВЕДОМОСТЬ НА ВЫДАЧУ БОНУСОВ KPI", { bold: true, size: 14 });
  text(2, 8, "«___» ____________ 20__ г.");
  ws.mergeCells(2, 8, 2, COLS);
  text(3, 1, `${quarterLabel(quarter, "ru")} (${MONTHS_FULL[monthIdx(months[0])]} – ${MONTHS_FULL[monthIdx(months[2])]})`);
  text(4, 1, scaleLine(tiers));
  let r = 5;
  for (const w of s.warnings) text(r++, 1, w, { bold: true, color: { argb: "FFC00000" } });
  r++;

  const head = r;
  const titles = ["№", "ФИО", "Филиал", "Карта KPI", ...months.map((m) => MONTHS_SHORT[monthIdx(m)]), "Средний %", "По шкале, сум", "К выдаче (CEO), сум"];
  titles.forEach((t, i) => {
    const c = text(head, i + 1, t, { bold: true, size: 10 });
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BOX;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  });
  ws.pageSetup.printTitlesRow = `${head}:${head}`;
  r++;

  for (const l of s.lines) {
    const values: (string | number | null)[] = [
      l.no, l.employee_name, l.terminal_name ?? "—", l.card_title ?? "—",
      ...months.map((_, i) => l.months[i] ?? "—"), l.avg_pct ?? "—", l.suggested_amount, l.ceo,
    ];
    values.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.font = { size: 10 };
      c.border = BOX;
      c.alignment = { vertical: "middle", wrapText: i >= 1 && i <= 3, horizontal: i >= 4 ? "right" : i === 0 ? "center" : "left" };
      if (typeof v === "number") c.numFmt = i <= 7 ? PCT_FMT : SUM_FMT;
    });
    ws.getRow(r).height = 28;
    r++;
  }
  text(r, 2, `Итого: ${s.total_count} чел.`, { bold: true, size: 10 });
  const tot = ws.getCell(r, 9);
  tot.value = s.total_suggested;
  tot.numFmt = SUM_FMT;
  tot.font = { bold: true, size: 10 };
  for (let c = 1; c <= COLS; c++) ws.getCell(r, c).border = BOX;
  r += 2;

  if (s.info.length) {
    text(r++, 1, "Не получают бонус в этом квартале (для сведения)", { bold: true });
    const infoHead = (row: number, vals: (string | number | null)[], font: Partial<Font>) => {
      // ФИО — B, Филиал — C, Средний % — D, Причина — E:J
      [2, 3, 4, 5].forEach((col, i) => {
        const c = ws.getCell(row, col);
        c.value = vals[i];
        c.font = font;
        c.border = BOX;
        c.alignment = { vertical: "middle", wrapText: true };
        if (typeof vals[i] === "number") c.numFmt = PCT_FMT;
      });
      ws.mergeCells(row, 5, row, COLS);
    };
    infoHead(r++, ["ФИО", "Филиал", "Средний %", "Причина"], { bold: true, size: 10 });
    for (const l of s.info) infoHead(r++, [l.employee_name, l.terminal_name ?? "—", l.avg_pct ?? "—", l.reason], { size: 10 });
    r++;
  }

  r++;
  text(r, 1, "Подготовил: HR ____________ / ____________ /");
  text(r, 7, "Утвердил: CEO ____________ / ____________ /");
}

// Книга .xlsx: лист на компанию, A4 альбомная, по ширине в одну страницу, заголовок таблицы повторяется.
export async function renderStatementXlsx(sheets: StatementSheet[], tiers: Tier[], quarter: Period): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const setup = (ws: Worksheet) => {
    ws.pageSetup = {
      ...ws.pageSetup,
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    };
  };
  if (sheets.length === 0) {
    const ws = wb.addWorksheet("Ведомость");
    setup(ws);
    ws.getCell("A1").value = EMPTY_TEXT;
  }
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.sheet_name);
    setup(ws);
    drawSheet(ws, s, tiers, quarter);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
