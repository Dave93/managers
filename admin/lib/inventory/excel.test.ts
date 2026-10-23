import { describe, expect, it } from "bun:test";
import * as XLSX from "xlsx";
import { buildWorkbook, fileName, interimSheet, sheetName, turnoverStoreSheet, turnoverSummarySheet } from "./excel";

const t = (k: string) => k;

const view = {
  period: "2026-09",
  store_id: "s1",
  store_name: "19001 - Склад Les Ойбек",
  with_sums: true,
  fetched_at: null,
  data_through: "2026-09-30",
  columns: [{ key: "start" }, { key: "transfer" }, { key: "cost_correction", sum_only: true }, { key: "end" }],
  lines: [
    { product_id: "p1", code: "00268", name: "Coca-Cola", unit_name: "шт", group_name: "Напитки", qty: { start: "101", transfer: "11", end: "112" }, sum: { start: "1000.5", end: "2000.25" }, transfer: { qty_in: "11", qty_out: "0" }, consistent: true },
    { product_id: "p2", code: "2201002001000713", name: "Cappy", unit_name: "шт", group_name: "Напитки", qty: {}, sum: { cost_correction: "0.1" }, transfer: { qty_in: "0", qty_out: "0" }, consistent: true },
    { product_id: "p3", code: null, name: "Мука", unit_name: "кг", group_name: "Сырьё", qty: { start: "2.5", end: "-1" }, sum: { start: "0.2" }, transfer: { qty_in: "0", qty_out: "0" }, consistent: false },
  ],
} as any;

describe("turnoverStoreSheet", () => {
  it("количество: без sum_only-колонки, нулевые в этом режиме строки скрыты, без «Итого»", () => {
    const s = turnoverStoreSheet(view, "qty", t, "title");
    expect(s.rows[0]).toEqual(["title"]);
    expect(s.rows[2]).toEqual(["col.code", "col.product", "col.unit", "col.start", "col.transfer", "col.end"]);
    expect(s.rows.slice(3)).toEqual([
      ["Напитки"],
      ["00268", "Coca-Cola", "шт", 101, 11, 112],
      ["Сырьё"],
      ["", "Мука", "кг", 2.5, 0, -1],
    ]);
    expect(s.money).toBe(false);
  });
  it("сумма: все колонки, ед. пустая, «Итого» в конце", () => {
    const s = turnoverStoreSheet(view, "sum", t, "title");
    expect(s.rows[2]).toEqual(["col.code", "col.product", "col.unit", "col.start", "col.transfer", "col.cost_correction", "col.end"]);
    expect(s.rows.at(-1)).toEqual(["", "total", "", 1000.7, 0, 0.1, 2000.25]);
    expect(s.rows.find((r) => r[1] === "Cappy")).toEqual(["2201002001000713", "Cappy", "", 0, 0, 0.1, 0]);
    expect(s.money).toBe(true);
  });
  it("филиал без сумм: режим «Сумма» не включается", () => {
    const s = turnoverStoreSheet({ ...view, with_sums: false }, "sum", t, "title");
    expect(s.rows[2]).not.toContain("col.cost_correction");
    expect(s.money).toBe(false);
  });
});

describe("turnoverSummarySheet", () => {
  it("склады и итог; нет значения → 0", () => {
    const s = turnoverSummarySheet(
      { period: "2026-09", columns: [{ key: "start" }, { key: "end" }], rows: [{ store_id: "s1", store_name: "Ойбек", sum: { start: "5" }, inconsistent: 0 }], total: { start: "5", end: "0" } } as any,
      t,
      "title",
    );
    expect(s.rows.slice(2)).toEqual([["col.store", "col.start", "col.end"], ["Ойбек", 5, 0], ["total", 5, 0]]);
  });
});

describe("interimSheet", () => {
  const labels = { sheet: "Сверка", product: "Товар", code: "Код", unit: "Ед.", a: "A", iiko: "iiko", diff: "±", checked: "Проверено" };
  const d = {
    lines: [
      { product_id: "p1", code: "39623", product_name: "Bonaqua", unit_name: "шт", group_name: "Напитки", admin_qty: "25", iiko_qty: "-1", diff_qty: "26", checked: true },
      { product_id: "p2", code: null, product_name: "Fanta", unit_name: "шт", group_name: "Напитки", admin_qty: "3", iiko_qty: "3", diff_qty: "0", checked: false },
      { product_id: "p3", code: "1", product_name: "Мука", unit_name: "кг", group_name: "Сырьё", admin_qty: "1", iiko_qty: null, diff_qty: null, checked: false },
    ],
  } as any;
  it("все строки; без снимка iiko — пустые ячейки", () => {
    expect(interimSheet(d, false, labels, "title").rows.slice(3)).toEqual([
      ["Напитки"],
      ["Bonaqua", "39623", "шт", 25, -1, 26, "✓"],
      ["Fanta", "", "шт", 3, 3, 0, ""],
      ["Сырьё"],
      ["Мука", "1", "кг", 1, null, null, ""],
    ]);
  });
  it("«Только A ≠ iiko» — только расхождения", () => {
    expect(interimSheet(d, true, labels, "title").rows.slice(3)).toEqual([["Напитки"], ["Bonaqua", "39623", "шт", 25, -1, 26, "✓"]]);
  });
});

describe("имена", () => {
  it("файл: без запрещённых символов, « - » склеивается", () => {
    expect(fileName(["Оборотная ведомость", "19001 - Склад Les Ойбек", "2026-09"])).toBe("Оборотная_ведомость_19001_Склад_Les_Ойбек_2026-09.xlsx");
    expect(fileName(["a/b: c", "", "d"])).toBe("a_b_c_d.xlsx");
  });
  it("лист: ≤ 31 символа, без [ ] : / ? *", () => {
    expect(sheetName("Сверка [1]: a/b")).toBe("Сверка  1   a b");
    expect(sheetName("x".repeat(40)).length).toBe(31);
    expect(sheetName("")).toBe("Sheet1");
  });
});

describe("buildWorkbook", () => {
  it("числа — числами, коды — текстом, суммы — в денежном формате", () => {
    const wb = buildWorkbook(XLSX, turnoverStoreSheet(view, "sum", t, "title"));
    const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellNF: true });
    const ws = back.Sheets[back.SheetNames[0]];
    expect(back.SheetNames[0]).toBe("title");
    expect(ws.A5).toMatchObject({ t: "s", v: "00268" });
    expect(ws.D5).toMatchObject({ t: "n", v: 1000.5, z: "#,##0.00" });
  });
  it("количество — без денежного формата", () => {
    const wb = buildWorkbook(XLSX, turnoverStoreSheet(view, "qty", t, "title"));
    const ws = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { cellNF: true }).Sheets.title;
    expect(ws.D5).toMatchObject({ t: "n", v: 101 });
    expect(ws.D5.z ?? "General").toBe("General");
  });
});
