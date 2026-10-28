// Выгрузка ОСВ и промежуточной сверки в Excel: то же, что на экране (режим, «Только A ≠ iiko»), но без
// поиска. Файл собирается в браузере из уже загруженных данных — права филиала соблюдены сервером.
// Числа пишем числами (не строкой formatQty: с разделителем тысяч Excel видит текст), коды — текстом
// (ведущие нули, длинные штрихкоды).
import type { WorkBook } from "xlsx";
import type { InterimReconDetail } from "@backend/modules/inventory/book/types";
import type { TurnoverStoreView, TurnoverSummary } from "@backend/modules/inventory/turnover/types";
import { interimGroups } from "./reconcile";
import { cellOf, columnsFor, turnoverGroups, type TurnoverMode } from "./turnover";

export type Cell = string | number | null;
/** name — имя листа; money — числа в формате суммы; widths — ширина колонок в символах. */
export interface Sheet { name: string; rows: Cell[][]; widths: number[]; money?: boolean }
type Label = (key: string) => string;

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Склад за месяц. t — переводы inventory.turnover; title — строка над таблицей. */
export function turnoverStoreSheet(view: TurnoverStoreView, mode: TurnoverMode, t: Label, title: string): Sheet {
  const m = view.with_sums ? mode : "qty";
  const cols = columnsFor(view.columns, m);
  const rows: Cell[][] = [[title], [], [t("col.code"), t("col.product"), t("col.unit"), ...cols.map((c) => t(`col.${c.key}`))]];
  const total = cols.map(() => 0);
  for (const [group, items] of turnoverGroups(view.lines, m)) {
    rows.push([group]);
    for (const l of items) {
      const vals = cols.map((c) => num(cellOf(l, c.key, m)) ?? 0);
      vals.forEach((v, i) => (total[i] += v));
      rows.push([l.code ?? "", l.name, m === "qty" ? l.unit_name ?? "" : "", ...vals]);
    }
  }
  // Итого — только в сумме: количества в разных единицах (шт, кг) не складываются.
  if (m === "sum") rows.push(["", t("total"), "", ...total.map(round)]);
  return { name: t("title"), rows, widths: [18, 42, 6, ...cols.map(() => 14)], money: m === "sum" };
}

/** Сводная по складам («Все склады»): только суммы, как на экране. */
export function turnoverSummarySheet(data: TurnoverSummary, t: Label, title: string): Sheet {
  const rows: Cell[][] = [[title], [], [t("col.store"), ...data.columns.map((c) => t(`col.${c.key}`))]];
  for (const r of data.rows) rows.push([r.store_name, ...data.columns.map((c) => num(r.sum[c.key]) ?? 0)]);
  rows.push([t("total"), ...data.columns.map((c) => num(data.total[c.key]) ?? 0)]);
  return { name: t("title"), rows, widths: [38, ...data.columns.map(() => 16)], money: true };
}

export interface InterimLabels { sheet: string; product: string; code: string; unit: string; a: string; iiko: string; diff: string; checked: string }

/** Промежуточная сверка склада за день. Нет снимка iiko — пустые ячейки, не 0. */
export function interimSheet(d: InterimReconDetail, only: boolean, l: InterimLabels, title: string): Sheet {
  const rows: Cell[][] = [[title], [], [l.product, l.code, l.unit, l.a, l.iiko, l.diff, l.checked]];
  for (const [group, items] of interimGroups(d.lines, only)) {
    rows.push([group]);
    for (const x of items) {
      rows.push([x.product_name, x.code ?? "", x.unit_name ?? "", num(x.admin_qty), num(x.iiko_qty), num(x.diff_qty), x.checked ? "✓" : ""]);
    }
  }
  return { name: l.sheet, rows, widths: [42, 18, 6, 14, 16, 12, 12] };
}

/** Имя файла: части через «_», без символов, запрещённых в именах файлов. «19001 - Склад» → «19001_Склад». */
export function fileName(parts: string[]): string {
  const clean = parts
    .map((p) => p.replace(/[\\/:*?"<>|[\]]/g, " ").replace(/\s+-\s+/g, " ").trim().replace(/\s+/g, "_"))
    .filter(Boolean);
  return `${clean.join("_")}.xlsx`;
}

/** Excel не принимает имя листа длиннее 31 символа и с \ / ? * [ ] : — SheetJS на таком падает. */
export function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet1";
}

export function buildWorkbook(XLSX: typeof import("xlsx"), sheet: Sheet): WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
  ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
  if (sheet.money) {
    for (const [addr, cell] of Object.entries(ws)) if (!addr.startsWith("!") && cell.t === "n") cell.z = "#,##0.00";
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(sheet.name));
  return wb;
}

/** Скачивание. xlsx грузим только по нажатию — в бандл страницы он не попадает. */
export async function downloadXlsx(name: string, sheet: Sheet): Promise<void> {
  const XLSX = await import("xlsx");
  XLSX.writeFile(buildWorkbook(XLSX, sheet), name);
}
