import { describe, expect, it } from "bun:test";
import { buildStatement } from "./bonus-statement";
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
