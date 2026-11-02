import { describe, expect, it } from "bun:test";
import type { AttendanceImportRow, AttendanceSheetPreview, UnmatchedReason } from "@admin/lib/kpi-api";
import {
  COMMIT_ISSUE_KEY, HISTORY_CHECK_FAILED, IMPORT_STATUS, MAPPING_FIELDS, UNMATCHED_REASON_TEXT, columnLabel, columnLetter, commitBodyIssue,
  defaultSheet, fileIssue, guessMapping, headersAt, importTotalsText, mappingIssues, organizationOptions, previewBody, replaceNotice,
  rowsCountText, skippedReasonsText, toMapping,
} from "./attendance";

describe("колонки", () => {
  it("columnLetter и columnLabel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(columnLabel(1, "Дата")).toBe("B — Дата");
    expect(columnLabel(2, "  ")).toBe("C — (без названия)");
  });
  it("headersAt и previewBody", () => {
    const rows = [["Workly", "", ""], ["", "", ""], ["Табель", "Дата", ""], ["T-1", "01.09.2025", ""], ["", "", ""], ["T-2", "02.09.2025", "x"]];
    expect(headersAt(rows, 3)).toEqual(["Табель", "Дата", ""]);
    expect(headersAt(rows, 30)).toEqual([]);
    expect(previewBody(rows, 3)).toEqual([["T-1", "01.09.2025", ""], ["T-2", "02.09.2025", "x"]]);
  });
});

describe("guessMapping", () => {
  it("русские заголовки", () => {
    expect(guessMapping(["№", "ФИО", "Табельный номер", "Дата", "Приход", "Уход", "Опоздание (мин)", "Прогул"]))
      .toEqual({ external_id: 2, date: 3, check_in: 4, check_out: 5, late_minutes: 6, absent: 7 });
    expect(guessMapping(["Таб. №", "Дата прихода", "Время прихода", "Время ухода"]))
      .toEqual({ external_id: 0, date: 1, check_in: 2, check_out: 3 });
  });
  it("id только целым словом", () => {
    expect(guessMapping(["ID", "Date"])).toEqual({ external_id: 0, date: 1 });
    expect(guessMapping(["Guid", "Валидность", "Сотрудник id"])).toEqual({ external_id: 2 });
    expect(guessMapping([])).toEqual({});
  });
});

describe("проверки", () => {
  it("mappingIssues", () => {
    expect(mappingIssues({})).toEqual({
      errors: ["Выберите колонку с табельным номером", "Выберите колонку с датой"],
      warnings: [
        "Колонка опоздания не выбрана: опоздания будут считаться нулевыми",
        "Колонка прогулов не выбрана: прогулы не попадут в расчёт, дни без отметок пропускаются",
      ],
    });
    expect(mappingIssues({ external_id: 0, date: 1, late_minutes: 2, absent: 3 })).toEqual({ errors: [], warnings: [] });
    expect(mappingIssues({ external_id: 0, date: 0, late_minutes: 0, absent: 0 }).errors).toEqual([]);
  });
  it("toMapping", () => {
    expect(toMapping({ external_id: 0, date: 1, check_in: 1 })).toEqual({ external_id: 0, date: 1, check_in: 1 });
    expect(toMapping({ external_id: 0 })).toBeNull();
  });
  it("fileIssue", () => {
    expect(fileIssue({ name: "workly.XLSX", size: 1000 })).toBeNull();
    expect(fileIssue({ name: "a.csv", size: 5 * 1024 * 1024 })).toBeNull();
    expect(fileIssue({ name: "a.csv", size: 5 * 1024 * 1024 + 1 })).toBe("Файл больше 5 МБ");
    expect(fileIssue({ name: "a.pdf", size: 10 })).toBe("Нужен файл xlsx, xls или csv");
    expect(fileIssue({ name: "a.csv", size: 0 })).toBe("Файл пустой");
  });
  it("defaultSheet", () => {
    const s = (name: string, total_rows: number): AttendanceSheetPreview => ({ name, total_rows, header_row: 1, headers: [], rows: [] });
    expect(defaultSheet([s("Сводка", 3), s("Данные", 40), s("Ещё", 40)])).toBe("Данные");
    expect(defaultSheet([])).toBe("");
  });
  it("подписи", () => {
    expect(MAPPING_FIELDS.map((f) => [f.key, f.label, f.required])).toEqual([
      ["external_id", "Табельный номер", true], ["date", "Дата", true], ["check_in", "Приход", false],
      ["check_out", "Уход", false], ["late_minutes", "Опоздание, мин", false], ["absent", "Прогул", false],
    ]);
    expect(Object.keys(UNMATCHED_REASON_TEXT).sort()).toEqual([
      "ambiguous_external_id", "bad_date", "bad_late", "bad_time", "duplicate_day", "no_external_id", "no_marks", "not_working_day",
      "outside_period", "unknown_external_id",
    ]);
    expect(UNMATCHED_REASON_TEXT.not_working_day).toBe("Нерабочий день (выходной, отпуск, больничный)");
    expect(UNMATCHED_REASON_TEXT.no_marks).toBe("Нет отметок прихода и ухода");
    expect([IMPORT_STATUS.committed, IMPORT_STATUS.replaced].map(({ label, tone }) => ({ label, tone }))).toEqual([{ label: "Действует", tone: "green" }, { label: "Заменён", tone: "gray" }]);
  });
});

describe("итоги и прошлые загрузки", () => {
  const ORG_A = "11111111-1111-4111-8111-111111111111";
  const ORG_B = "22222222-2222-4222-8222-222222222222";
  const imp = (o: Partial<AttendanceImportRow>): AttendanceImportRow => ({
    id: "i1", period: "2025-09-01", file_name: "workly.xlsx", uploaded_by: "u1", uploaded_by_name: null, organization_id: ORG_A, source: "file",
    sheet: "Лист1", header_row: 1, mapping: { external_id: 0, date: 1 }, rows_total: 50, rows_matched: 42, rows_unmatched: 8, rows_skipped: 0, skipped: [], days_present: 38, days_late: 5,
    days_absent: 4, unmatched: [], status: "committed", created_at: "2025-10-02T05:30:00.000Z", ...o,
  });
  it("importTotalsText", () => {
    expect(importTotalsText(imp({}))).toBe("Дней: 38, с опозданием: 5, прогулов: 4");
    expect(importTotalsText(imp({ days_present: 0, days_late: 0, days_absent: 0 }))).toBe("Дней: 0, с опозданием: 0, прогулов: 0");
  });
  it("строка счётчиков: «не сопоставлено» отдельно от «пропущено»", () => {
    expect(rowsCountText(imp({ rows_total: 9, rows_matched: 5, rows_unmatched: 1, rows_skipped: 3 }))).toBe(
      "Строк: 9 · сопоставлено: 5 · не сопоставлено: 1 · пропущено: 3"
    );
  });
  it("skippedReasonsText: причины с числом строк, без пояснения в скобках", () => {
    const r = (reason: UnmatchedReason) => ({ reason });
    expect(skippedReasonsText([r("not_working_day"), r("no_marks"), r("not_working_day")])).toBe("Нерабочий день: 2, Нет отметок прихода и ухода: 1");
    expect(skippedReasonsText([])).toBe("");
  });
  const ORG = { id: ORG_A, name: "Les Ailes" };
  const NOTICE_A =
    "Импорт организации «Les Ailes» за сентябрь 2025 будет заменён: «workly.xlsx», загружен 02.10.2025 10:30, сопоставлено строк: 42. " +
    "Сотрудники, которых нет в новом файле, потеряют данные за месяц";
  it("replaceNotice: действующий импорт выбранной организации, сбой истории, ничего", () => {
    const text = replaceNotice({ data: [imp({ id: "i0", status: "replaced", file_name: "old.xlsx" }), imp({})], error: null }, "2025-09-01", ORG);
    expect(text).toBe(NOTICE_A);
    expect(replaceNotice({ data: undefined, error: new Error("сеть") }, "2025-09-01", ORG)).toBe(HISTORY_CHECK_FAILED);
    expect(HISTORY_CHECK_FAILED).toBe("Не удалось проверить прошлые загрузки");
    // Сбой фонового обновления при уже загруженной истории: верим последним данным
    expect(replaceNotice({ data: [imp({})], error: new Error("сеть") }, "2025-09-01", ORG)).toBe(text);
    expect(replaceNotice({ data: [], error: new Error("сеть") }, "2025-09-01", ORG)).toBeNull();
    expect(replaceNotice({ data: [imp({ status: "replaced" })], error: null }, "2025-09-01", ORG)).toBeNull();
    expect(replaceNotice({ data: undefined, error: null }, "2025-09-01", ORG)).toBeNull();
  });
  it("replaceNotice: заменяется импорт только выбранной организации", () => {
    // История месяца содержит импорты всех организаций
    expect(replaceNotice({ data: [imp({ organization_id: ORG_B })], error: null }, "2025-09-01", ORG)).toBeNull();
    expect(replaceNotice({ data: [imp({ organization_id: ORG_B }), imp({})], error: null }, "2025-09-01", ORG)).toBe(NOTICE_A);
    // Для другой организации предупреждение про её собственный импорт
    expect(replaceNotice({ data: [imp({ organization_id: ORG_B, file_name: "chopar.xlsx" })], error: null }, "2025-09-01", { id: ORG_B, name: "Chopar" })).toBe(
      "Импорт организации «Chopar» за сентябрь 2025 будет заменён: «chopar.xlsx», загружен 02.10.2025 10:30, сопоставлено строк: 42. " +
        "Сотрудники, которых нет в новом файле, потеряют данные за месяц"
    );
    // Прежний импорт без организации коммит не заменяет: не предупреждаем
    expect(replaceNotice({ data: [imp({ organization_id: null })], error: null }, "2025-09-01", ORG)).toBeNull();
    // Заменённый импорт выбранной организации уже не действует
    expect(replaceNotice({ data: [imp({ status: "replaced" }), imp({ organization_id: ORG_B })], error: null }, "2025-09-01", ORG)).toBeNull();
    // Импорт из API той же организации коммит файла тоже заменяет
    expect(replaceNotice({ data: [imp({ source: "api", file_name: "Workly API", sheet: null, header_row: null, mapping: null })], error: null }, "2025-09-01", ORG)).toContain(
      "«Workly API»"
    );
  });
  it("replaceNotice: пока организация не выбрана — без предупреждения, даже при сбое истории", () => {
    expect(replaceNotice({ data: [imp({})], error: null }, "2025-09-01", null)).toBeNull();
    expect(replaceNotice({ data: [imp({})], error: null }, "2025-09-01", undefined)).toBeNull();
    expect(replaceNotice({ data: undefined, error: new Error("сеть") }, "2025-09-01", null)).toBeNull();
  });
  it("commitBodyIssue: без организации — organization_required, с организацией — null", () => {
    expect(commitBodyIssue({ organization_id: "" })).toBe("organization_required");
    expect(commitBodyIssue({ organization_id: "   " })).toBe("organization_required");
    expect(commitBodyIssue({ organization_id: undefined })).toBe("organization_required");
    expect(commitBodyIssue({ organization_id: null })).toBe("organization_required");
    expect(commitBodyIssue({})).toBe("organization_required");
    expect(commitBodyIssue({ organization_id: ORG_A })).toBeNull();
    expect(commitBodyIssue({ organization_id: "o1" })).toBeNull();
    expect(COMMIT_ISSUE_KEY.organization_required).toBe("lib.attendance.issue.organizationRequired");
  });
  it("organizationOptions: только подключения с организацией, без повторов", () => {
    const e = (key: string, organization_id: string | null, organization_name: string) => ({ key, organization_id, organization_name });
    expect(
      organizationOptions([e("les", ORG_A, "Les Ailes"), e("none", null, "Без организации"), e("chopar", ORG_B, "Chopar"), e("les2", ORG_A, "Les Ailes")])
    ).toEqual([{ id: ORG_A, name: "Les Ailes" }, { id: ORG_B, name: "Chopar" }]);
    expect(organizationOptions([e("none", null, "Без организации")])).toEqual([]);
    expect(organizationOptions(undefined)).toEqual([]);
    expect(organizationOptions([])).toEqual([]);
  });
});
