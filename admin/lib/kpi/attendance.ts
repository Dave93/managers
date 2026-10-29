// Загрузка Workly: подсказки по колонкам, проверки формы и подписи.
import type {
  AttendanceField,
  AttendanceImportRow,
  AttendanceMapping,
  AttendanceSheetPreview,
  UnmatchedReason,
} from "@admin/lib/kpi-api";
import { formatTashkent } from "./format";
import { monthLabel } from "./periods";
import type { Tone } from "./status";

/** Колонки выбраны по номеру (0 — A); у необязательных полей может не быть. */
export type MappingDraft = Partial<Record<AttendanceField, number>>;

export const MAPPING_FIELDS: readonly { key: AttendanceField; label: string; required: boolean }[] = [
  { key: "external_id", label: "Табельный номер", required: true },
  { key: "date", label: "Дата", required: true },
  { key: "check_in", label: "Приход", required: false },
  { key: "check_out", label: "Уход", required: false },
  { key: "late_minutes", label: "Опоздание, мин", required: false },
  { key: "absent", label: "Прогул", required: false },
];

/** Буквы колонок Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(i: number): string {
  let n = Math.floor(i) + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function columnLabel(i: number, header: string): string {
  return `${columnLetter(i)} — ${header.trim() || "(без названия)"}`;
}

/** Строка заголовков по номеру с 1; вне таблицы — пусто. */
export function headersAt(rows: readonly string[][], headerRow: number): string[] {
  return [...(rows[headerRow - 1] ?? [])];
}

/** Строки после заголовка, полностью пустые отброшены. */
export function previewBody(rows: readonly string[][], headerRow: number): string[][] {
  return rows.slice(headerRow).filter((r) => r.some((c) => c.trim() !== ""));
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/ё/g, "е");
}

const MATCHERS: [AttendanceField, (h: string, words: string[]) => boolean][] = [
  ["external_id", (h, w) => h.includes("табел") || /таб\.?\s*№/.test(h) || w.includes("id")],
  ["date", (h, w) => h.includes("дата") || w.includes("date")],
  ["check_in", (h) => h.includes("приход")],
  ["check_out", (h) => h.includes("уход")],
  ["late_minutes", (h) => h.includes("опоздан")],
  ["absent", (h) => h.includes("прогул")],
];

/** Угадывает колонки по заголовкам: каждому полю — первая свободная подходящая слева. */
export function guessMapping(headers: readonly string[]): MappingDraft {
  const prepared = headers.map((h) => {
    const t = norm(h);
    return { t, words: t.split(/[^a-zа-я0-9№]+/).filter(Boolean) };
  });
  const used = new Set<number>();
  const out: MappingDraft = {};
  for (const [field, test] of MATCHERS) {
    const i = prepared.findIndex((p, idx) => !used.has(idx) && test(p.t, p.words));
    if (i >= 0) {
      out[field] = i;
      used.add(i);
    }
  }
  return out;
}

export function mappingIssues(m: MappingDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (m.external_id === undefined) errors.push("Выберите колонку с табельным номером");
  if (m.date === undefined) errors.push("Выберите колонку с датой");
  if (m.late_minutes === undefined) warnings.push("Колонка опоздания не выбрана: опоздания будут считаться нулевыми");
  if (m.absent === undefined) {
    warnings.push("Колонка прогулов не выбрана: прогулы не попадут в расчёт, дни без отметок пропускаются");
  }
  return { errors, warnings };
}

export function toMapping(m: MappingDraft): AttendanceMapping | null {
  if (m.external_id === undefined || m.date === undefined) return null;
  const out: AttendanceMapping = { external_id: m.external_id, date: m.date };
  for (const k of ["check_in", "check_out", "late_minutes", "absent"] as const) {
    const v = m[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Лист с наибольшим числом строк; при равенстве первый. */
export function defaultSheet(sheets: readonly AttendanceSheetPreview[]): string {
  let best: AttendanceSheetPreview | null = null;
  for (const s of sheets) if (!best || s.total_rows > best.total_rows) best = s;
  return best?.name ?? "";
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function fileIssue(f: { name: string; size: number }): string | null {
  if (!/\.(xlsx|xls|csv)$/i.test(f.name)) return "Нужен файл xlsx, xls или csv";
  if (f.size === 0) return "Файл пустой";
  if (f.size > MAX_FILE_BYTES) return "Файл больше 5 МБ";
  return null;
}

export const UNMATCHED_REASON_TEXT: Record<UnmatchedReason, string> = {
  no_external_id: "Пустой табельный номер",
  unknown_external_id: "Нет активного сотрудника с таким табельным номером",
  ambiguous_external_id: "Табельный номер у нескольких сотрудников",
  bad_date: "Дата не распознана",
  outside_period: "Дата вне выбранного месяца",
  bad_time: "Время прихода или ухода не распознано",
  bad_late: "Опоздание — не целое число минут",
  duplicate_day: "Вторая строка за тот же день, учтена первая",
  not_working_day: "Нерабочий день (выходной, отпуск, больничный)",
  no_marks: "Нет отметок прихода и ухода",
};

/** Строка итогов: «не сопоставлено» — только строки без найденного сотрудника, «пропущено» — строки найденных, не попавшие в учёт. */
export function rowsCountText(r: Pick<AttendanceImportRow, "rows_total" | "rows_matched" | "rows_unmatched" | "rows_skipped">): string {
  return `Строк: ${r.rows_total} · сопоставлено: ${r.rows_matched} · не сопоставлено: ${r.rows_unmatched} · пропущено: ${r.rows_skipped}`;
}

/** Причины пропуска по строкам: «Нерабочий день: 2, Нет отметок прихода и ухода: 1». */
export function skippedReasonsText(rows: readonly { reason: UnmatchedReason }[]): string {
  const n = new Map<UnmatchedReason, number>();
  for (const r of rows) n.set(r.reason, (n.get(r.reason) ?? 0) + 1);
  return [...n].map(([k, c]) => `${(UNMATCHED_REASON_TEXT[k] ?? k).replace(/ \(.*\)$/, "")}: ${c}`).join(", ");
}

/** Итоги по сопоставленным дням: по ним видно, учлись ли прогулы и опоздания. */
export function importTotalsText(t: Pick<AttendanceImportRow, "days_present" | "days_late" | "days_absent">): string {
  return `Дней: ${t.days_present}, с опозданием: ${t.days_late}, прогулов: ${t.days_absent}`;
}

export const HISTORY_CHECK_FAILED = "Не удалось проверить прошлые загрузки";

/**
 * Предупреждение перед загрузкой: действующий импорт месяца будет заменён целиком.
 * Историю загрузить не удалось и данных нет — так и пишем, а не молчим.
 */
export function replaceNotice(
  history: { data: readonly AttendanceImportRow[] | undefined; error: unknown },
  period: string
): string | null {
  const existing = history.data?.find((r) => r.status === "committed");
  if (existing) {
    return (
      `За ${monthLabel(period)} уже загружен «${existing.file_name}» ${formatTashkent(existing.created_at)}, ` +
      `сопоставлено строк: ${existing.rows_matched}. Новая загрузка заменит его. ` +
      "Сотрудники, которых нет в новом файле, потеряют данные за месяц"
    );
  }
  if (history.error != null && history.data === undefined) return HISTORY_CHECK_FAILED;
  return null;
}

export const IMPORT_STATUS: Record<"committed" | "replaced", { label: string; tone: Tone }> = {
  committed: { label: "Действует", tone: "green" },
  replaced: { label: "Заменён", tone: "gray" },
};
