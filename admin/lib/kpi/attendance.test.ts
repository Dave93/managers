import { describe, expect, it } from "bun:test";
import type { AttendanceSheetPreview } from "@admin/lib/kpi-api";
import {
  IMPORT_STATUS, MAPPING_FIELDS, UNMATCHED_REASON_TEXT, columnLabel, columnLetter, defaultSheet, fileIssue,
  guessMapping, headersAt, mappingIssues, previewBody, toMapping,
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
      warnings: ["Колонка опоздания не выбрана: опоздания будут считаться нулевыми", "Колонка прогула не выбрана: прогулы не будут учтены"],
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
      "ambiguous_external_id", "bad_date", "bad_late", "bad_time", "duplicate_day", "no_external_id", "outside_period", "unknown_external_id",
    ]);
    expect([IMPORT_STATUS.committed, IMPORT_STATUS.replaced]).toEqual([{ label: "Действует", tone: "green" }, { label: "Заменён", tone: "gray" }]);
  });
});
