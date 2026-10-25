import { describe, expect, it } from "bun:test";
import * as XLSX from "xlsx";
import * as A from "./attendance-parse";
import { KpiError } from "./errors";

const P = "2025-09-01";
const M = { external_id: 0, date: 1, check_in: 2, check_out: 3, late_minutes: 4, absent: 5 };
const grid = (raw: A.Cell[][], text?: string[][]): A.Grid => ({
  name: "Лист1",
  raw,
  text: text ?? raw.map((r) => r.map((c) => (c === null ? "" : String(c)))),
});
// Кириллица в windows-1251: А..я → 0xC0..0xFF, остальное ASCII.
const cp1251 = (s: string) =>
  Uint8Array.from([...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x350;
    throw new Error(`нет в тесте: ${ch}`);
  }));
const xlsx = (wb: XLSX.WorkBook, bookType: XLSX.BookType = "xlsx") => new Uint8Array(XLSX.write(wb, { type: "buffer", bookType }));
const caught = (fn: () => unknown) => { try { fn(); } catch (e) { return e; } return null; };

describe("файл", () => {
  it("fileKind по расширению", () => {
    expect(A.fileKind("Workly.XLSX")).toBe("xlsx");
    expect(A.fileKind("a.xls")).toBe("xls");
    expect(A.fileKind("a.csv")).toBe("csv");
    expect(A.fileKind("a.txt")).toBeNull();
    expect(A.fileKind("xlsx")).toBeNull();
  });
  it("xlsx: сетка от A1, пустой лист пропускается", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Пусто");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Табель", "Дата"], ["T-1", 45901]], { origin: "B3" } as XLSX.AOA2SheetOpts), "Данные");
    const g = A.readGrids(xlsx(wb), "xlsx");
    expect(g.map((x) => x.name)).toEqual(["Данные"]);
    expect(g[0].raw[2]).toEqual([null, "Табель", "Дата"]);
    expect(g[0].raw[3]).toEqual([null, "T-1", 45901]);
    expect(g[0].text[3]).toEqual(["", "T-1", "45901"]);
  });
  it("xls и HTML под видом xls читаются", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Табель"], ["T-1"]]), "Лист1");
    expect(A.readGrids(xlsx(wb, "biff8"), "xls")[0].raw).toEqual([["Табель"], ["T-1"]]);
    const html = new TextEncoder().encode("<table><tr><td>Табель</td><td>Дата</td></tr><tr><td>T-1</td><td>01.09.2025</td></tr></table>");
    expect(A.readGrids(html, "xls")[0].raw).toEqual([["Табель", "Дата"], ["T-1", "01.09.2025"]]);
  });
  it("мусор под видом xlsx и xls — bad_file", () => {
    for (const kind of ["xlsx", "xls"] as const) {
      const e = caught(() => A.readGrids(new Uint8Array([1, 2, 3, 4, 5]), kind));
      expect(e).toBeInstanceOf(KpiError);
      expect((e as KpiError).code).toBe("bad_file");
    }
  });
  it("csv: cp1251, точка с запятой, дата остаётся строкой", () => {
    const g = A.readGrids(cp1251("Табель;Дата;Приход\nT-1;01.09.2025;9:05\n"), "csv");
    expect(g[0].raw).toEqual([["Табель", "Дата", "Приход"], ["T-1", "01.09.2025", "9:05"]]);
  });
  it("csv: UTF-8 с BOM и запятой; пустой файл — нет листов", () => {
    const g = A.readGrids(new TextEncoder().encode("\ufeffid,date\nT-2,2025-09-02\n"), "csv");
    expect(g[0].raw).toEqual([["id", "date"], ["T-2", "2025-09-02"]]);
    expect(A.readGrids(new Uint8Array(), "csv")).toEqual([]);
  });
  it("предпросмотр: строка заголовков, 20 строк, ширина", () => {
    const raw: A.Cell[][] = [
      ["Отчёт Workly", null, null],
      [null, null, null],
      ["Табель", "Дата", "Приход"],
      ...Array.from({ length: 30 }, (_, i) => [`T-${i}`, 45901, "09:00"]),
    ];
    const p = A.previewOf(grid(raw));
    expect(p.header_row).toBe(3);
    expect(p.headers).toEqual(["Табель", "Дата", "Приход"]);
    expect(p.rows).toHaveLength(20);
    expect(p.rows[0]).toEqual(["Отчёт Workly", "", ""]);
    expect(p.total_rows).toBe(33);
    expect(A.guessHeaderRow([["одна"], ["ячейка"]])).toBe(1);
  });
});

describe("ячейки", () => {
  it("parseDay", () => {
    expect(A.parseDay(45901)).toBe("2025-09-01");
    expect(A.parseDay(45901.75)).toBe("2025-09-01");
    expect(A.parseDay("01.09.2025")).toBe("2025-09-01");
    expect(A.parseDay("1.9.2025")).toBe("2025-09-01");
    expect(A.parseDay(" 2025-09-30 ")).toBe("2025-09-30");
    expect(A.parseDay("2025-09-30 18:00")).toBe("2025-09-30");
    expect(A.parseDay("02.09.2025 09:05:00")).toBe("2025-09-02");
    for (const bad of ["31.02.2025", "2025-13-01", "9/1/25", "", null, true, 0, "вчера"]) expect(A.parseDay(bad as A.Cell)).toBeNull();
  });
  it("parseTime: ташкентское время в UTC", () => {
    const D = "2025-09-01";
    expect(A.parseTime("09:05", D)).toBe("2025-09-01T04:05:00.000Z");
    expect(A.parseTime("9:05:30", D)).toBe("2025-09-01T04:05:30.000Z");
    expect(A.parseTime(0.378472222, D)).toBe("2025-09-01T04:05:00.000Z");
    expect(A.parseTime(45901.378472222, D)).toBe("2025-09-01T04:05:00.000Z");
    expect(A.parseTime("02.09.2025 01:30", D)).toBe("2025-09-01T20:30:00.000Z");
    expect(A.parseTime("2025-09-02T01:30:00", D)).toBe("2025-09-01T20:30:00.000Z");
    expect(A.parseTime("", D)).toBeNull();
    expect(A.parseTime(null, D)).toBeNull();
    for (const bad of ["25:00", "9.05", "утро", true]) expect(A.parseTime(bad as A.Cell, D)).toBe("bad");
  });
  it("parseLate", () => {
    expect(A.parseLate(null)).toBe(0);
    expect(A.parseLate("")).toBe(0);
    expect(A.parseLate(15)).toBe(15);
    expect(A.parseLate(" 7 ")).toBe(7);
    expect(A.parseLate("0:15")).toBe(15);
    expect(A.parseLate("01:02:30")).toBe(62);
    expect(A.parseLate(15 / 1440)).toBe(15);
    for (const bad of [-1, 2.5, "-3", "15 мин", true]) expect(A.parseLate(bad as A.Cell)).toBe("bad");
  });
  it("parseAbsent", () => {
    for (const yes of [1, "1", "да", "ДА", " Yes ", "true", "+", "Прогул", true]) expect(A.parseAbsent(yes as A.Cell)).toBe(true);
    for (const no of [0, "0", "нет", "-", "", null, false, "опоздание"]) expect(A.parseAbsent(no as A.Cell)).toBe(false);
  });
  it("validateMapping", () => {
    expect(A.validateMapping({ external_id: 0, date: 1 }, 3)).toEqual({ external_id: 0, date: 1 });
    expect(A.validateMapping({ external_id: 0, date: 2, check_in: 2, late_minutes: null }, 3)).toEqual({ external_id: 0, date: 2, check_in: 2 });
    for (const bad of [null, {}, { external_id: 0 }, { external_id: 0, date: 3 }, { external_id: -1, date: 1 }, { external_id: 0, date: 1.5 }, { external_id: 0, date: "1" }, { external_id: 0, date: 1, foo: 2 }]) {
      expect(A.validateMapping(bad, 3)).toBeNull();
    }
  });
});

describe("строки", () => {
  const H = ["Табель", "Дата", "Приход", "Уход", "Опоздание", "Прогул"];
  it("разбор, причины по номеру строки Excel, пустые строки не считаются", () => {
    const raw: A.Cell[][] = [
      H,
      ["T-1", 45901, "09:05", "18:00", 5, null],         // 2
      [null, null, null, null, null, null],               // 3 пустая
      ["", 45902, null, null, null, null],                // 4 no_external_id
      ["T-1", "31.02.2025", null, null, null, null],      // 5 bad_date
      ["T-1", "01.10.2025", null, null, null, null],      // 6 outside_period
      ["T-1", 45903, "утро", null, null, null],           // 7 bad_time
      ["T-1", 45904, null, null, "много", null],          // 8 bad_late
      ["T-2", "05.09.2025", null, null, null, "прогул"],  // 9
      ["T-3", 45905, "22:00", "06:00", 0, null],          // 10 ночная смена
    ];
    const r = A.parseRows(grid(raw), { headerRow: 1, mapping: M, period: P });
    expect(r.total).toBe(8);
    expect(r.bad).toEqual([
      { row: 4, external_id: null, reason: "no_external_id" },
      { row: 5, external_id: "T-1", reason: "bad_date" },
      { row: 6, external_id: "T-1", reason: "outside_period" },
      { row: 7, external_id: "T-1", reason: "bad_time" },
      { row: 8, external_id: "T-1", reason: "bad_late" },
    ]);
    expect(r.rows).toEqual([
      { row: 2, external_id: "T-1", day: "2025-09-01", check_in: "2025-09-01T04:05:00.000Z", check_out: "2025-09-01T13:00:00.000Z", late_minutes: 5, absent: false },
      { row: 9, external_id: "T-2", day: "2025-09-05", check_in: null, check_out: null, late_minutes: 0, absent: true },
      { row: 10, external_id: "T-3", day: "2025-09-05", check_in: "2025-09-05T17:00:00.000Z", check_out: "2025-09-06T01:00:00.000Z", late_minutes: 0, absent: false },
    ]);
  });
  it("строки над заголовком не читаются", () => {
    const raw: A.Cell[][] = [["Workly, сентябрь", null], ["Табель", "Дата"], ["T-1", 45901]];
    const r = A.parseRows(grid(raw), { headerRow: 2, mapping: { external_id: 0, date: 1 }, period: P });
    expect([r.total, r.rows.map((x) => x.row)]).toEqual([1, [3]]);
  });
  it("табельный номер берётся из текста ячейки: ведущие нули сохраняются", () => {
    const raw: A.Cell[][] = [["Таб. №", "Дата"], [123, 45901], [1234, 45902]];
    const text = [["Таб. №", "Дата"], ["00123", "01.09.2025"], ["1234", "02.09.2025"]];
    const r = A.parseRows(grid(raw, text), { headerRow: 1, mapping: { external_id: 0, date: 1 }, period: P });
    expect(r.rows.map((x) => x.external_id)).toEqual(["00123", "1234"]);
  });
  it("одна колонка даёт и дату, и приход", () => {
    const raw: A.Cell[][] = [["Табель", "Приход"], ["T-1", "02.09.2025 09:10"]];
    const r = A.parseRows(grid(raw), { headerRow: 1, mapping: { external_id: 0, date: 1, check_in: 1 }, period: P });
    expect(r.rows[0]).toMatchObject({ day: "2025-09-02", check_in: "2025-09-02T04:10:00.000Z" });
  });
});

describe("сопоставление", () => {
  const row = (r: number, ext: string, day = "2025-09-01"): A.ParsedRow =>
    ({ row: r, external_id: ext, day, check_in: null, check_out: null, late_minutes: 0, absent: false });
  const emps: A.MatchEmployee[] = [
    { id: "e1", terminal_id: "t1", external_id: " T-1 " },
    { id: "e2", terminal_id: "t2", external_id: "T-2" },
    { id: "e3", terminal_id: "t2", external_id: "T-2" },
    { id: "e4", terminal_id: "t1", external_id: null },
  ];
  it("точное совпадение после обрезки, дубли номера и дня", () => {
    const r = A.matchRows([row(2, "T-1"), row(3, "t-1"), row(4, "T-2"), row(5, "T-9"), row(6, "T-1"), row(7, "T-1", "2025-09-02")], emps);
    expect(r.days.map((d) => [d.row, d.employee_id, d.terminal_id, d.day])).toEqual([[2, "e1", "t1", "2025-09-01"], [7, "e1", "t1", "2025-09-02"]]);
    expect(r.bad).toEqual([
      { row: 3, external_id: "t-1", reason: "unknown_external_id" },
      { row: 4, external_id: "T-2", reason: "ambiguous_external_id" },
      { row: 5, external_id: "T-9", reason: "unknown_external_id" },
      { row: 6, external_id: "T-1", reason: "duplicate_day" },
    ]);
  });
});

describe("предложение", () => {
  const d = (absent: boolean, late = 0) => ({ absent, late_minutes: late });
  it("нет строк — null", () => expect(A.attendanceSuggestion([])).toBeNull());
  it("вовремя ÷ (присутствие + прогулы)", () => {
    expect(A.attendanceSuggestion([d(false), d(false), d(false, 10)])).toEqual({
      days: 3, ontime: 2, late: 1, absent: 0, score: 67, basis: "Workly: 3 дня, вовремя 2, опозданий 1, прогулов 0",
    });
    expect(A.attendanceSuggestion([d(false), d(true, 30)])).toEqual({
      days: 2, ontime: 1, late: 0, absent: 1, score: 50, basis: "Workly: 2 дня, вовремя 1, опозданий 0, прогулов 1",
    });
    expect(A.attendanceSuggestion(Array.from({ length: 25 }, (_, i) => d(false, i < 3 ? 5 : 0)))).toMatchObject({
      score: 88, basis: "Workly: 25 дней, вовремя 22, опозданий 3, прогулов 0",
    });
    expect(A.attendanceSuggestion(Array.from({ length: 21 }, () => d(false)))!.basis).toBe("Workly: 21 день, вовремя 21, опозданий 0, прогулов 0");
    expect(A.attendanceSuggestion(Array.from({ length: 11 }, () => d(false)))!.basis.startsWith("Workly: 11 дней,")).toBe(true);
    expect(A.attendanceSuggestion([d(true)])).toMatchObject({ score: 0 });
  });
});
