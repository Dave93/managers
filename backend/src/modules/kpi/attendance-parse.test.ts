import { describe, expect, it } from "bun:test";
import * as XLSX from "xlsx";
import * as A from "./attendance-parse";
import { KpiError } from "./errors";
import type { UnmatchedRow } from "./types";

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
  // Писатель SheetJS обходит каждую ячейку диапазона, поэтому заявленный диапазон
  // отдаём только в тег dimension (третье чтение !ref в write_ws_xml), данные пишутся по A1:B2
  const declared = (ref: string) => {
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"], ["c", "d"]]);
    let reads = 0;
    Object.defineProperty(ws, "!ref", { get: () => (++reads === 3 ? ref : "A1:B2"), enumerable: true, configurable: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Лист1");
    return xlsx(wb);
  };
  const tooLarge = (bytes: Uint8Array) => {
    const t0 = performance.now();
    const e = caught(() => A.readGrids(bytes, "xlsx"));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(e).toBeInstanceOf(KpiError);
    expect((e as KpiError).code).toBe("sheet_too_large");
    expect((e as KpiError).extra).toEqual({ max_rows: A.MAX_ROWS, max_cols: A.MAX_COLS });
  };
  it("лист шире 100 столбцов — sheet_too_large быстро", () => {
    tooLarge(declared("A1:XFD1000"));
    tooLarge(declared("A1:CW5"));
  });
  it("лист длиннее 50000 строк — sheet_too_large быстро", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Array.from({ length: A.MAX_ROWS + 1 }, (_, i) => [i])), "Лист1");
    tooLarge(xlsx(wb));
  });
  it("заявленный диапазон A1:XFD1048576 не раздувает сетку: читаются только реальные ячейки", () => {
    const t0 = performance.now();
    const g = A.readGrids(declared("A1:XFD1048576"), "xlsx");
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(g[0].raw).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("лист ровно на пределе столбцов читается", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([Array.from({ length: A.MAX_COLS }, (_, i) => `c${i}`)]), "Лист1");
    expect(A.readGrids(xlsx(wb), "xlsx")[0].raw[0]).toHaveLength(A.MAX_COLS);
  });
  it("HTML под видом xls с BOM и пробелами читается", () => {
    const html = new TextEncoder().encode("<table><tr><td>Табель</td><td>Дата</td></tr></table>");
    const withBom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x0d, 0x0a, 0x20, ...html]);
    expect(A.readGrids(withBom, "xls")[0].raw).toEqual([["Табель", "Дата"]]);
  });
  it("объединённые ячейки: значение и текст левой верхней во всех ячейках диапазона", () => {
    const ws = XLSX.utils.aoa_to_sheet([["Табель", "Дата"], [null, 45901], [null, 45902], [null, 45903], ["T-2", 45901]]);
    // Номер числом с форматом «000»: в тексте ведущие нули, их и копируем
    ws["A2"] = { t: "n", v: 7, z: "000" };
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Лист1");
    const g = A.readGrids(xlsx(wb), "xlsx")[0];
    expect(g.raw.map((r) => r[0])).toEqual(["Табель", 7, 7, 7, "T-2"]);
    expect(g.text.map((r) => r[0])).toEqual(["Табель", "007", "007", "007", "T-2"]);
    const r = A.parseRows(g, { headerRow: 1, mapping: { external_id: 0, date: 1 }, period: P });
    expect(r.rows.map((x) => [x.external_id, x.day])).toEqual([
      ["007", "2025-09-01"], ["007", "2025-09-02"], ["007", "2025-09-03"], ["T-2", "2025-09-01"],
    ]);
    expect(r.bad).toEqual([]);
  });
  it("объединённые ячейки HTML (rowspan) и диапазон шире листа", () => {
    const html = new TextEncoder().encode(
      `<table><tr><td>Табель</td><td>Дата</td></tr><tr><td rowspan="2">T-1</td><td>01.09.2025</td></tr><tr><td>02.09.2025</td></tr></table>`
    );
    expect(A.readGrids(html, "xls")[0].raw).toEqual([["Табель", "Дата"], ["T-1", "01.09.2025"], ["T-1", "02.09.2025"]]);
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"], ["c", "d"]]);
    ws["!merges"] = [{ s: { r: 1, c: 1 }, e: { r: 60000, c: 300 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Лист1");
    const g = A.readGrids(xlsx(wb), "xlsx")[0];
    expect(g.raw).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("пересекающиеся объединения — bad_file, а не часы работы", () => {
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"], ["c", "d"]]);
    ws["!merges"] = Array.from({ length: 3 }, () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Лист1");
    const e = caught(() => A.readGrids(xlsx(wb), "xlsx"));
    expect(e).toBeInstanceOf(KpiError);
    expect((e as KpiError).code).toBe("bad_file");
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
    for (const bad of ["25:00", "9.05", "утро", true, "---", "-3"]) expect(A.parseTime(bad as A.Cell, D)).toBe("bad");
  });
  it("прочерки вместо времени и опоздания — пусто", () => {
    for (const dash of ["-", "—", "–", "--", "--:--", " -- "]) {
      expect(A.parseTime(dash, "2025-09-01")).toBeNull();
      expect(A.parseLate(dash)).toBe(0);
    }
  });
  it("parseLate", () => {
    expect(A.parseLate(null)).toBe(0);
    expect(A.parseLate("")).toBe(0);
    expect(A.parseLate(15)).toBe(15);
    expect(A.parseLate(" 7 ")).toBe(7);
    expect(A.parseLate("0:15")).toBe(15);
    expect(A.parseLate("01:02:30")).toBe(62);
    expect(A.parseLate(15 / 1440)).toBe(15);
    expect(A.parseLate(1440)).toBe(1440);
    expect(A.parseLate("24:00")).toBe(1440);
    for (const bad of [-1, 2.5, "-3", "15 мин", true, 1441, "1441", "24:01"]) expect(A.parseLate(bad as A.Cell)).toBe("bad");
  });
  it("parseAbsent", () => {
    const yes = [1, "1", "да", "ДА", " Yes ", "true", "+", "Прогул", true, "неявка", "Отсутствие", "не пришел", "НЕ  ПРИШЁЛ", "н", "НН", "нб", "Absent"];
    for (const v of yes) expect(A.parseAbsent(v as A.Cell)).toBe(true);
    for (const no of [0, "0", "нет", "-", "", null, false, "опоздание", "выходной", "в", "нбк", "пришел"]) expect(A.parseAbsent(no as A.Cell)).toBe(false);
  });
  it("dayKind: прогул, нерабочий день, присутствие", () => {
    for (const v of ["прогул", "Н", true, 1]) expect(A.dayKind(v as A.Cell)).toBe("absent");
    for (const v of ["Выходной", "отпуск", "БОЛЬНИЧНЫЙ", "в", "От", "б", "Day  Off", "vacation", "SICK"]) expect(A.dayKind(v)).toBe("off");
    for (const v of [null, "", "-", 0, "нет", "выходные дни", "больничный лист"]) expect(A.dayKind(v as A.Cell)).toBe("present");
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
  it("R6: прогул читается первым, нерабочие дни и дни без отметок не считаются", () => {
    const raw: A.Cell[][] = [
      H,
      ["T-1", 45901, "--:--", "--:--", "—", "Неявка"],   // 2 прогул, время-заглушки
      ["T-1", 45902, "утро", "вечер", "много", "Н"],      // 3 прогул: мусор во времени не мешает
      ["T-1", 45903, "-", "-", "-", "Выходной"],          // 4 not_working_day
      ["T-1", 45904, "09:00", "18:00", 0, "ОТПУСК"],      // 5 not_working_day даже с отметками
      ["T-1", 45905, "–", "--", "", ""],                   // 6 no_marks
      ["T-1", 45906, null, null, 15, null],                // 7 no_marks: опоздание без отметок
      ["T-1", 45907, "09:00", "-", "-", "-"],              // 8 есть приход, ухода нет
      ["T-1", 45908, null, null, null, "не пришёл"],       // 9 прогул
      ["T-1", 45909, null, null, null, "day off"],         // 10 not_working_day
    ];
    const r = A.parseRows(grid(raw), { headerRow: 1, mapping: M, period: P });
    expect(r.total).toBe(9);
    expect(r.bad).toEqual([
      { row: 4, external_id: "T-1", reason: "not_working_day" },
      { row: 5, external_id: "T-1", reason: "not_working_day" },
      { row: 6, external_id: "T-1", reason: "no_marks" },
      { row: 7, external_id: "T-1", reason: "no_marks" },
      { row: 10, external_id: "T-1", reason: "not_working_day" },
    ]);
    const absent = (row: number, day: string) => ({ row, external_id: "T-1", day, check_in: null, check_out: null, late_minutes: 0, absent: true });
    expect(r.rows).toEqual([
      absent(2, "2025-09-01"),
      absent(3, "2025-09-02"),
      { row: 8, external_id: "T-1", day: "2025-09-07", check_in: "2025-09-07T04:00:00.000Z", check_out: null, late_minutes: 0, absent: false },
      absent(9, "2025-09-08"),
    ]);
  });
  it("без колонок прихода и ухода строка без отметок — присутствие", () => {
    const raw: A.Cell[][] = [["Табель", "Дата", "Прогул"], ["T-1", 45901, ""], ["T-1", 45902, "прогул"], ["T-1", 45903, "в"]];
    const r = A.parseRows(grid(raw), { headerRow: 1, mapping: { external_id: 0, date: 1, absent: 2 }, period: P });
    expect(r.rows.map((x) => [x.row, x.absent])).toEqual([[2, false], [3, true]]);
    expect(r.bad).toEqual([{ row: 4, external_id: "T-1", reason: "not_working_day" }]);
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

describe("не сопоставлено и пропущено", () => {
  const emps: A.MatchEmployee[] = [
    { id: "e1", terminal_id: "t1", external_id: "T-1" },
    { id: "e2", terminal_id: "t1", external_id: "T-2" },
    { id: "e3", terminal_id: "t2", external_id: "T-2" },
  ];
  const bad = (row: number, external_id: string | null, reason: UnmatchedRow["reason"]): UnmatchedRow => ({ row, external_id, reason });
  it("«Нерабочий день» найденного сотрудника — пропуск, а не «не сопоставлено»", () => {
    const r = A.splitBad([bad(5, "T-1", "not_working_day"), bad(6, "T-1", "no_marks"), bad(7, "T-1", "outside_period")], [bad(8, "T-1", "duplicate_day")], emps);
    expect(r.unmatched).toEqual([]);
    expect(r.skipped.map((x) => [x.row, x.reason])).toEqual([[5, "not_working_day"], [6, "no_marks"], [7, "outside_period"], [8, "duplicate_day"]]);
  });
  it("строки без найденного сотрудника остаются «не сопоставлено», причина про сотрудника", () => {
    const r = A.splitBad(
      [bad(2, null, "no_external_id"), bad(3, "T-9", "not_working_day"), bad(4, "T-2", "bad_date"), bad(5, " t-1 ", "bad_time")],
      [bad(6, "T-9", "unknown_external_id"), bad(7, "T-2", "ambiguous_external_id")],
      emps
    );
    expect(r.skipped).toEqual([]);
    expect(r.unmatched).toEqual([
      bad(2, null, "no_external_id"),
      bad(3, "T-9", "unknown_external_id"),
      bad(4, "T-2", "ambiguous_external_id"),
      bad(5, " t-1 ", "unknown_external_id"),
      bad(6, "T-9", "unknown_external_id"),
      bad(7, "T-2", "ambiguous_external_id"),
    ]);
  });
  it("смесь: оба списка по строкам Excel, счётчики не пересекаются", () => {
    const r = A.splitBad([bad(9, "T-1", "not_working_day"), bad(3, "T-9", "bad_late")], [bad(4, "T-9", "unknown_external_id"), bad(2, "T-1", "duplicate_day")], emps);
    expect(r.unmatched.map((x) => x.row)).toEqual([3, 4]);
    expect(r.skipped.map((x) => x.row)).toEqual([2, 9]);
  });
});

describe("предложение", () => {
  const d = (absent: boolean, late = 0) => ({ absent, late_minutes: late });
  it("нет строк — null", () => expect(A.attendanceSuggestion([])).toBeNull());
  it("итоги импорта: присутствие, опоздания, прогулы", () => {
    expect(A.importTotals([])).toEqual({ days_present: 0, days_late: 0, days_absent: 0 });
    expect(A.importTotals([d(false), d(false, 5), d(false, 1), d(true), d(true)])).toEqual({ days_present: 3, days_late: 2, days_absent: 2 });
  });
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
