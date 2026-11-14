import { describe, expect, it } from "bun:test";
import { buildStatement, renderStatementXlsx } from "./bonus-statement";
import type { RaiseRow, Tier } from "./types";

const TIERS: Tier[] = [
  { min_pct: 95, amount: 500000 },
  { min_pct: 85, amount: 300000 },
  { min_pct: 75, amount: 200000 },
];
const MIN = 2;
const LES = { organization_id: "org-les", organization_name: "Les Ailes" };
const CHOPAR = { organization_id: "org-ch", organization_name: "ChoparPizza" };

let n = 0;
const row = (o: Partial<RaiseRow> = {}): RaiseRow => ({
  id: `r${++n}`,
  quarter_start: "2026-07-01",
  employee_id: `e${n}`,
  employee_name: `Сотрудник ${n}`,
  terminal_name: "Филиал",
  ...LES,
  card_title: "Кассир",
  months: [
    { period: "2026-07-01", score_pct: 86 },
    { period: "2026-08-01", score_pct: 88 },
    { period: "2026-09-01", score_pct: 87 },
  ],
  months_scored: 3,
  avg_pct: 87,
  suggested_amount: 300000,
  status: "proposed",
  approved_amount: null,
  decided_by_name: null,
  decided_at: null,
  comment: null,
  periods_closed: true,
  stale: false,
  ...o,
});
const below = (o: Partial<RaiseRow> = {}) => row({ avg_pct: 71.3, suggested_amount: 0, ...o });
const fewMonths = (o: Partial<RaiseRow> = {}) =>
  row({ months_scored: 1, avg_pct: 80, suggested_amount: 0, status: "insufficient", ...o });

describe("buildStatement", () => {
  it("две компании → два листа по имени, строка без организации на «Без компании» последним", () => {
    const sheets = buildStatement(
      [row(LES), row(CHOPAR), row({ organization_id: null, organization_name: null })],
      TIERS,
      MIN,
    );
    expect(sheets.map((s) => s.company)).toEqual(["ChoparPizza", "Les Ailes", "Без компании"]);
    expect(sheets.map((s) => s.sheet_name)).toEqual(["ChoparPizza", "Les Ailes", "Без компании"]);
    expect(sheets.map((s) => s.lines.length)).toEqual([1, 1, 1]);
  });

  it("основной список: suggested>0 любого статуса и approved>0 при suggested 0; остальные в info", () => {
    const keep = [
      row({ employee_name: "А" }),
      row({ employee_name: "Б", status: "rejected" }),
      below({ employee_name: "В", status: "approved", approved_amount: 100000 }),
    ];
    const out = [below({ employee_name: "Г" }), fewMonths({ employee_name: "Д" })];
    const [s] = buildStatement([...out, ...keep], TIERS, MIN);
    expect(s.lines.map((l) => l.employee_name)).toEqual(["А", "Б", "В"]);
    expect(s.info.map((l) => l.employee_name)).toEqual(["Г", "Д"]);
  });

  it("ceo: proposed → null; approved 300000 → 300000; approved 0 → «отказ»; rejected → «отказ»", () => {
    const [s] = buildStatement(
      [
        row({ employee_name: "1" }),
        row({ employee_name: "2", status: "approved", approved_amount: 300000 }),
        row({ employee_name: "3", status: "approved", approved_amount: 0 }),
        row({ employee_name: "4", status: "rejected" }),
      ],
      TIERS,
      MIN,
    );
    expect(s.lines.map((l) => l.ceo)).toEqual([null, 300000, "отказ", "отказ"]);
  });

  it("сортировка: филиал, затем ФИО (филиал null в конце); no = 1, 2, …", () => {
    const [s] = buildStatement(
      [
        row({ employee_name: "Яков", terminal_name: "Чиланзар" }),
        row({ employee_name: "Борис", terminal_name: null }),
        row({ employee_name: "Анна", terminal_name: "Чиланзар" }),
        row({ employee_name: "Вера", terminal_name: "Айбек" }),
      ],
      TIERS,
      MIN,
    );
    expect(s.lines.map((l) => [l.no, l.terminal_name, l.employee_name])).toEqual([
      ["1", "Айбек", "Вера"],
      ["2", "Чиланзар", "Анна"],
      ["3", "Чиланзар", "Яков"],
      ["4", null, "Борис"],
    ]);
  });

  it("итог: total_count и total_suggested по основному списку", () => {
    const [s] = buildStatement(
      [row(), row({ avg_pct: 96, suggested_amount: 500000 }), row({ avg_pct: 80, suggested_amount: 200000 }), below()],
      TIERS,
      MIN,
    );
    expect(s.total_count).toBe(3);
    expect(s.total_suggested).toBe(1000000);
  });

  it("строка листа: месяцы, средний, карта, филиал переносятся как есть", () => {
    const [s] = buildStatement([row({ months: [{ period: "2026-07-01", score_pct: 86 }, { period: "2026-08-01", score_pct: null }, { period: "2026-09-01", score_pct: 88 }] })], TIERS, MIN);
    expect(s.lines[0]).toMatchObject({ months: [86, null, 88], avg_pct: 87, card_title: "Кассир", terminal_name: "Филиал", suggested_amount: 300000 });
  });

  it("причина: мало оценок по числу месяцев даже у отклонённой строки; иначе ниже порога", () => {
    const [s] = buildStatement(
      [
        fewMonths({ employee_name: "А" }),
        fewMonths({ employee_name: "Б", status: "rejected" }),
        below({ employee_name: "В" }),
        below({ employee_name: "Г", status: "approved", approved_amount: 0 }),
      ],
      TIERS,
      MIN,
    );
    expect(s.info.map((l) => [l.employee_name, l.reason])).toEqual([
      ["А", "мало оценок: 1 из 2 нужных"],
      ["Б", "мало оценок: 1 из 2 нужных, решение HR: отказ"],
      ["В", "ниже порога 75 %"],
      ["Г", "ниже порога 75 %, решение HR: отказ"],
    ]);
    expect(s.info[2].avg_pct).toBe(71.3);
  });

  it("причина без шкалы — «шкала не задана»", () => {
    const [s] = buildStatement([below()], [], MIN);
    expect(s.info[0].reason).toBe("шкала не задана");
  });

  it("шкала менялась: proposed avg 80 с suggested 150000 → «1*» и предупреждение; решённая строка без пометки", () => {
    const [s] = buildStatement(
      [
        row({ employee_name: "А", avg_pct: 80, suggested_amount: 150000 }),
        row({ employee_name: "Б", avg_pct: 80, suggested_amount: 150000, status: "approved", approved_amount: 150000 }),
      ],
      TIERS,
      MIN,
    );
    expect(s.lines.map((l) => l.no)).toEqual(["1*", "2"]);
    expect(s.warnings).toEqual(["Шкала бонусов менялась после расчёта. Нажмите «Пересчитать» и выгрузите заново"]);
  });

  it("шкала не менялась → нет пометок и предупреждений", () => {
    const [s] = buildStatement([row(), below(), fewMonths()], TIERS, MIN);
    expect(s.lines.map((l) => l.no)).toEqual(["1"]);
    expect(s.warnings).toEqual([]);
  });

  it("для сведения: строка, посчитанная по старой шкале, — причина «по текущей шкале … нужен пересчёт», не «ниже порога»", () => {
    const [s] = buildStatement([row({ employee_name: "А", avg_pct: 80, suggested_amount: 0 })], TIERS, MIN);
    expect(s.lines).toEqual([]);
    expect(s.info[0].reason).toBe("по текущей шкале — 200 000 сум, нужен пересчёт");
    expect(s.warnings).toEqual(["Шкала бонусов менялась после расчёта. Нажмите «Пересчитать» и выгрузите заново"]);
  });

  it("для сведения: stale-строка ниже порога — причина с пометкой о пересчёте", () => {
    const [s] = buildStatement([below({ stale: true })], TIERS, MIN);
    expect(s.info[0].reason).toBe("ниже порога 75 %, оценки менялись — нужен пересчёт");
  });

  it("одинаковые имена листов (без учёта регистра и после очистки) получают суффикс", () => {
    const sheets = buildStatement(
      [
        row({ organization_id: "a", organization_name: "Org" }),
        row({ organization_id: "b", organization_name: "org" }),
        row({ organization_id: "c", organization_name: "/:*" }),
        row({ organization_id: null, organization_name: null }),
      ],
      TIERS,
      MIN,
    );
    const names = sheets.map((s) => s.sheet_name.toLowerCase());
    expect(new Set(names).size).toBe(4);
    expect(sheets.map((s) => s.sheet_name).every((n) => n.length <= 31)).toBe(true);
  });

  it("stale → «*» и предупреждение; periods_closed false → «Предварительно…» первым", () => {
    const [s] = buildStatement([row({ stale: true }), row({ periods_closed: false })], TIERS, MIN);
    expect(s.lines.map((l) => l.no)).toEqual(["1*", "2"]);
    expect(s.warnings).toEqual([
      "Предварительно: месяцы квартала ещё не закрыты, суммы могут измениться",
      "Оценки менялись после расчёта. Нажмите «Пересчитать» и выгрузите заново",
    ]);
  });

  it("предупреждения считаются по листу: stale у одной компании не попадает на лист другой", () => {
    const sheets = buildStatement([row({ ...LES, stale: true }), row(CHOPAR)], TIERS, MIN);
    expect(sheets.find((s) => s.company === "ChoparPizza")!.warnings).toEqual([]);
    expect(sheets.find((s) => s.company === "Les Ailes")!.warnings).toHaveLength(1);
  });

  it("sheet_name: запрещённые символы убраны, длинное имя обрезано до 31", () => {
    const long = "Очень длинное название компании для листа";
    const sheets = buildStatement(
      [row({ organization_id: "x", organization_name: "A/B:C*" }), row({ organization_id: "y", organization_name: long })],
      TIERS,
      MIN,
    );
    const name = (c: string) => sheets.find((s) => s.company === c)!.sheet_name;
    expect(name("A/B:C*")).toBe("ABC");
    expect(name(long)).toBe(long.slice(0, 31));
  });

  it("пустой вход → []", () => {
    expect(buildStatement([], TIERS, MIN)).toEqual([]);
  });
});

describe("renderStatementXlsx", () => {
  const load = async (buf: Buffer) => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return wb;
  };
  const findRow = (ws: import("exceljs").Worksheet, text: string) => {
    let found = 0;
    ws.eachRow((r, i) => {
      if (!found && r.getCell(2).value === text) found = i;
    });
    return found;
  };
  const Q = "2026-07-01";

  it("листы и имена совпадают со sheet_name", async () => {
    const sheets = buildStatement([row(LES), row(CHOPAR)], TIERS, MIN);
    const wb = await load(await renderStatementXlsx(sheets, TIERS, Q));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ChoparPizza", "Les Ailes"]);
  });

  it("шапка: компания, заголовок, квартал с месяцами, шкала по возрастанию", async () => {
    const wb = await load(await renderStatementXlsx(buildStatement([row(LES)], TIERS, MIN), TIERS, Q));
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("Les Ailes");
    expect(ws.getCell("A2").value).toBe("ВЕДОМОСТЬ НА ВЫДАЧУ БОНУСОВ KPI");
    expect(ws.getCell("A3").value).toBe("III квартал 2026 (июль – сентябрь)");
    expect(ws.getCell("A4").value).toBe("Шкала: от 75 % — 200 000 · от 85 % — 300 000 · от 95 % — 500 000 сум");
    expect(ws.getCell("H1").value).toBe("Утверждаю: ____________ CEO");
  });

  it("строка сотрудника: числа с форматами, пустой месяц «—», колонка CEO", async () => {
    const sheets = buildStatement(
      [
        row({ employee_name: "Анна", months: [{ period: Q, score_pct: 86 }, { period: "2026-08-01", score_pct: null }, { period: "2026-09-01", score_pct: 88 }] }),
        row({ employee_name: "Борис", status: "rejected" }),
      ],
      TIERS,
      MIN,
    );
    const ws = (await load(await renderStatementXlsx(sheets, TIERS, Q))).worksheets[0];
    const a = ws.getRow(findRow(ws, "Анна"));
    expect(a.getCell(1).value).toBe("1");
    expect(a.getCell(3).value).toBe("Филиал");
    expect(a.getCell(4).value).toBe("Кассир");
    expect(a.getCell(5).value).toBe(86);
    expect(a.getCell(6).value).toBe("—");
    expect(a.getCell(8).value).toBe(87);
    expect(a.getCell(8).numFmt).toBe("0.00");
    expect(a.getCell(9).value).toBe(300000);
    expect(a.getCell(9).numFmt).toBe("#,##0");
    expect(a.getCell(10).value ?? null).toBeNull();
    expect(ws.getRow(findRow(ws, "Борис")).getCell(10).value).toBe("отказ");
    const total = ws.getRow(findRow(ws, "Итого: 2 чел."));
    expect(total.getCell(9).value).toBe(600000);
    expect(total.getCell(9).numFmt).toBe("#,##0");
  });

  it("заголовок таблицы с месяцами квартала и повтором при печати", async () => {
    const ws = (await load(await renderStatementXlsx(buildStatement([row()], TIERS, MIN), TIERS, Q))).worksheets[0];
    const h = findRow(ws, "ФИО");
    expect(h).toBeGreaterThan(4);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => ws.getRow(h).getCell(c).value)).toEqual([
      "№", "ФИО", "Филиал", "Карта KPI", "Июл", "Авг", "Сен", "Средний %", "По шкале, сум", "К выдаче (CEO), сум",
    ]);
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.fitToPage).toBe(true);
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.fitToHeight).toBe(0);
    expect(ws.pageSetup.printTitlesRow).toBe(`${h}:${h}`);
  });

  it("предупреждения, блок «для сведения» и подписи", async () => {
    const sheets = buildStatement([row({ stale: true }), fewMonths({ employee_name: "Дина" })], TIERS, MIN);
    const ws = (await load(await renderStatementXlsx(sheets, TIERS, Q))).worksheets[0];
    const texts: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => typeof c.value === "string" && texts.push(c.value)));
    expect(texts).toContain("Оценки менялись после расчёта. Нажмите «Пересчитать» и выгрузите заново");
    expect(texts).toContain("Не получают бонус в этом квартале (для сведения)");
    expect(texts).toContain("мало оценок: 1 из 2 нужных");
    expect(texts).toContain("Подготовил: HR ____________ / ____________ /");
    expect(texts).toContain("Утвердил: CEO ____________ / ____________ /");
    expect(findRow(ws, "Дина")).toBeGreaterThan(findRow(ws, "Итого: 1 чел."));
  });

  it("без шкалы — «Шкала: не задана»", async () => {
    const ws = (await load(await renderStatementXlsx(buildStatement([below()], [], MIN), [], Q))).worksheets[0];
    expect(ws.getCell("A4").value).toBe("Шкала: не задана");
  });

  it("книга с совпадающими именами компаний собирается без ошибки", async () => {
    const sheets = buildStatement([row({ organization_id: "a", organization_name: "Org" }), row({ organization_id: "b", organization_name: "org" })], TIERS, MIN);
    const wb = await load(await renderStatementXlsx(sheets, TIERS, Q));
    expect(wb.worksheets).toHaveLength(2);
  });

  it("пустой вход → один лист «Ведомость» с подсказкой", async () => {
    const wb = await load(await renderStatementXlsx([], TIERS, Q));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Ведомость"]);
    expect(wb.worksheets[0].getCell("A1").value).toBe("За квартал нет расчёта. Нажмите «Пересчитать».");
  });
});
