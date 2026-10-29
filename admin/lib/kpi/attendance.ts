// Загрузка Workly: подсказки по колонкам, проверки формы и подписи.
import type {
  AttendanceField,
  AttendanceImportRow,
  AttendanceMapping,
  AttendanceSheetPreview,
  UnmatchedReason,
} from "@admin/lib/kpi-api";
import { formatTashkent } from "./format";
import { ruT, type KpiT } from "./i18n";
import { monthLabel } from "./periods";
import type { Tone } from "./status";

/** Колонки выбраны по номеру (0 — A); у необязательных полей может не быть. */
export type MappingDraft = Partial<Record<AttendanceField, number>>;

/** label — русский запасной текст; в интерфейсе переводите `t(labelKey)`. */
export const MAPPING_FIELDS: readonly { key: AttendanceField; label: string; labelKey: string; required: boolean }[] = [
  { key: "external_id", label: ruT("lib.attendance.field.external_id"), labelKey: "lib.attendance.field.external_id", required: true },
  { key: "date", label: ruT("lib.attendance.field.date"), labelKey: "lib.attendance.field.date", required: true },
  { key: "check_in", label: ruT("lib.attendance.field.check_in"), labelKey: "lib.attendance.field.check_in", required: false },
  { key: "check_out", label: ruT("lib.attendance.field.check_out"), labelKey: "lib.attendance.field.check_out", required: false },
  { key: "late_minutes", label: ruT("lib.attendance.field.late_minutes"), labelKey: "lib.attendance.field.late_minutes", required: false },
  { key: "absent", label: ruT("lib.attendance.field.absent"), labelKey: "lib.attendance.field.absent", required: false },
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

export function columnLabel(i: number, header: string, t: KpiT = ruT): string {
  return `${columnLetter(i)} — ${header.trim() || t("lib.attendance.noHeader")}`;
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

export function mappingIssues(m: MappingDraft, t: KpiT = ruT): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (m.external_id === undefined) errors.push(t("lib.attendance.issue.noExternalId"));
  if (m.date === undefined) errors.push(t("lib.attendance.issue.noDate"));
  if (m.late_minutes === undefined) warnings.push(t("lib.attendance.issue.noLate"));
  if (m.absent === undefined) {
    warnings.push(t("lib.attendance.issue.noAbsent"));
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

export function fileIssue(f: { name: string; size: number }, t: KpiT = ruT): string | null {
  if (!/\.(xlsx|xls|csv)$/i.test(f.name)) return t("lib.attendance.file.type");
  if (f.size === 0) return t("lib.attendance.file.empty");
  if (f.size > MAX_FILE_BYTES) return t("lib.attendance.file.size");
  return null;
}

/** Ключи причин: `t(UNMATCHED_REASON_KEY[reason])`. */
export const UNMATCHED_REASON_KEY: Record<UnmatchedReason, string> = {
  no_external_id: "lib.attendance.unmatched.no_external_id",
  unknown_external_id: "lib.attendance.unmatched.unknown_external_id",
  ambiguous_external_id: "lib.attendance.unmatched.ambiguous_external_id",
  bad_date: "lib.attendance.unmatched.bad_date",
  outside_period: "lib.attendance.unmatched.outside_period",
  bad_time: "lib.attendance.unmatched.bad_time",
  bad_late: "lib.attendance.unmatched.bad_late",
  duplicate_day: "lib.attendance.unmatched.duplicate_day",
  not_working_day: "lib.attendance.unmatched.not_working_day",
  no_marks: "lib.attendance.unmatched.no_marks",
};

/** Русские тексты причин (запасной вариант без `t`). */
export const UNMATCHED_REASON_TEXT: Record<UnmatchedReason, string> = Object.fromEntries(
  Object.entries(UNMATCHED_REASON_KEY).map(([k, key]) => [k, ruT(key)])
) as Record<UnmatchedReason, string>;

const reasonText = (k: UnmatchedReason, t: KpiT) => (Object.hasOwn(UNMATCHED_REASON_KEY, k) ? t(UNMATCHED_REASON_KEY[k]) : k);

/** Строка итогов: «не сопоставлено» — только строки без найденного сотрудника, «пропущено» — строки найденных, не попавшие в учёт. */
export function rowsCountText(r: Pick<AttendanceImportRow, "rows_total" | "rows_matched" | "rows_unmatched" | "rows_skipped">, t: KpiT = ruT): string {
  return t("lib.attendance.rowsCount", { total: r.rows_total, matched: r.rows_matched, unmatched: r.rows_unmatched, skipped: r.rows_skipped });
}

/** Причины пропуска по строкам: «Нерабочий день: 2, Нет отметок прихода и ухода: 1». */
export function skippedReasonsText(rows: readonly { reason: UnmatchedReason }[], t: KpiT = ruT): string {
  const n = new Map<UnmatchedReason, number>();
  for (const r of rows) n.set(r.reason, (n.get(r.reason) ?? 0) + 1);
  return [...n].map(([k, c]) => `${reasonText(k, t).replace(/ \(.*\)$/, "")}: ${c}`).join(", ");
}

/** Итоги по сопоставленным дням: по ним видно, учлись ли прогулы и опоздания. */
export function importTotalsText(r: Pick<AttendanceImportRow, "days_present" | "days_late" | "days_absent">, t: KpiT = ruT): string {
  return t("lib.attendance.totals", { present: r.days_present, late: r.days_late, absent: r.days_absent });
}

export const HISTORY_CHECK_FAILED = ruT("lib.attendance.historyFailed");

/**
 * Предупреждение перед загрузкой: действующий импорт месяца будет заменён целиком.
 * Историю загрузить не удалось и данных нет — так и пишем, а не молчим.
 */
export function replaceNotice(
  history: { data: readonly AttendanceImportRow[] | undefined; error: unknown },
  period: string,
  t: KpiT = ruT,
  locale = "ru"
): string | null {
  const existing = history.data?.find((r) => r.status === "committed");
  if (existing) {
    return t("lib.attendance.replace", {
      month: monthLabel(period, locale),
      file: existing.file_name,
      date: formatTashkent(existing.created_at),
      matched: existing.rows_matched,
    });
  }
  if (history.error != null && history.data === undefined) return t("lib.attendance.historyFailed");
  return null;
}

export const IMPORT_STATUS: Record<"committed" | "replaced", { label: string; labelKey: string; tone: Tone }> = {
  committed: { label: ruT("lib.status.import.committed"), labelKey: "lib.status.import.committed", tone: "green" },
  replaced: { label: ruT("lib.status.import.replaced"), labelKey: "lib.status.import.replaced", tone: "gray" },
};
