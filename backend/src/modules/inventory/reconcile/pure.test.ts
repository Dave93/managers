import { describe, expect, it } from "bun:test";
import {
  bookAt,
  buildLines,
  correctionsFor,
  diffCorrections,
  inventoryDocs,
  isMonthly,
  nextDay,
  parseOlapCorrections,
  parseStoreOperations,
  pickDocument,
  previousPeriods,
  sameTotals,
  toIikoDate,
  toIikoTimestamp,
  totals,
  totalsToDb,
  unitCost,
  type IikoDoc,
} from "./pure";

const S1 = "7e0661d8-0b59-4d57-a66e-6434a9895559";
const S2 = "6cd986d1-d79e-40d8-981d-65e7a2d93328";

function item(fields: Record<string, string>) {
  return `<storeReportItemDto>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</storeReportItemDto>`;
}

describe("parseStoreOperations + inventoryDocs", () => {
  const xml = `<?xml version="1.0"?><storeReportItemDtoes>${[
    item({ sum: "-9905579.000000000", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d1", documentComment: "Месяц", documentNum: "2115", primaryStore: S1 }),
    item({ sum: "14379599.000000000", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d1", documentComment: "Месяц", documentNum: "2115", primaryStore: S1 }),
    item({ sum: "-500", date: "31.08.2026", type: "STORE_COST_CORRECTION", documentId: "x1", primaryStore: S1 }),
    item({ sum: "100", date: "31.08.2026", type: "INVENTORY_CORRECTION", documentId: "d2", documentComment: "Склад &amp; кухня", documentNum: "2116", primaryStore: S2 }),
  ].join("")}</storeReportItemDtoes>`;

  it("разбирает строки, дату переводит в YYYY-MM-DD, раскрывает &amp;", () => {
    const rows = parseStoreOperations(xml);
    expect(rows.length).toBe(4);
    expect(rows[0]).toEqual({ document_id: "d1", num: "2115", comment: "Месяц", store_id: S1, date: "2026-08-31", type: "INVENTORY_CORRECTION", sum: -9905579 });
    expect(rows[3].comment).toBe("Склад & кухня");
    expect(rows[2].num).toBeNull();
  });

  it("документ = INVENTORY_CORRECTION с номером; недостача и излишек суммируются отдельно", () => {
    const docs = inventoryDocs(parseStoreOperations(xml));
    expect(docs.map((d) => d.num).sort()).toEqual(["2115", "2116"]);
    const d1 = docs.find((d) => d.num === "2115")!;
    expect(d1.shortage_sum).toBe(-9905579);
    expect(d1.surplus_sum).toBe(14379599);
  });

  it("isMonthly — без учёта регистра, null — нет", () => {
    expect(isMonthly("Месяц")).toBe(true);
    expect(isMonthly("инвентаризация за МЕСЯЦ")).toBe(true);
    expect(isMonthly("Неделя")).toBe(false);
    expect(isMonthly(null)).toBe(false);
  });
});

describe("pickDocument", () => {
  const doc = (id: string, num: string, comment: string | null): IikoDoc => ({
    id, num, comment, store_id: S1, date: "2026-08-31", shortage_sum: 0, surplus_sum: 0,
  });

  it("ровно один «Месяц» — он", () => {
    const c = pickDocument([doc("a", "10", null), doc("b", "11", "Месяц")], null);
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("b");
  });
  it("два «Месяц» — нужен выбор, кандидаты по номеру", () => {
    const c = pickDocument([doc("b", "12", "Месяц"), doc("a", "9", "месяц")], null);
    expect(c.kind).toBe("needs_choice");
    if (c.kind === "needs_choice") expect(c.candidates.map((d) => d.num)).toEqual(["9", "12"]);
  });
  it("ни одного «Месяц», но есть другие — нужен выбор", () => {
    expect(pickDocument([doc("a", "10", null)], null).kind).toBe("needs_choice");
  });
  it("документов нет — none", () => {
    expect(pickDocument([], null).kind).toBe("none");
  });
  it("ранее выбранный документ сохраняется, даже если «Месяц» другой", () => {
    const c = pickDocument([doc("a", "10", null), doc("b", "11", "Месяц")], "a");
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("a");
  });
  it("ранее выбранного больше нет — обычные правила", () => {
    const c = pickDocument([doc("b", "11", "Месяц")], "gone");
    expect(c.kind).toBe("chosen");
    if (c.kind === "chosen") expect(c.doc.id).toBe("b");
  });
});

describe("OLAP корректировки", () => {
  const data = [
    { "Account.Id": S1, Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 9, "Sum.ResignedSum": 14860 },
    { "Account.Id": S1, Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p2", "Product.Name": "Упаковка", Amount: -38, "Sum.ResignedSum": -19181 },
    // другая сторона проводки — счёт недостач: в строки склада не попадает
    { "Account.Id": "67af8bc9-628f-2124-2345-3750bb7db6fa", Document: "2115", "DateTime.Typed": "2026-08-31T23:59:00", "Product.Id": "p2", "Product.Name": "Упаковка", Amount: 38, "Sum.ResignedSum": 19181 },
    { "Account.Id": S1, Document: "999", "DateTime.Typed": "2026-08-31T12:00:00", "Product.Id": "p1", "Product.Name": "Вода", Amount: 1, "Sum.ResignedSum": 1 },
  ];
  it("строки склада по номеру документа и время документа", () => {
    const r = correctionsFor(parseOlapCorrections(data), S1, "2115");
    expect(r.at).toBe("2026-08-31T23:59:00");
    expect(r.lines).toEqual([
      { product_id: "p1", product_name: "Вода", qty: 9, sum: 14860 },
      { product_id: "p2", product_name: "Упаковка", qty: -38, sum: -19181 },
    ]);
  });
  it("нет строк — at null", () => {
    expect(correctionsFor(parseOlapCorrections(data), S1, "1").at).toBeNull();
  });
});

describe("даты", () => {
  it("bookAt — минута до документа, без документа — 23:58 периода", () => {
    expect(bookAt("2026-08-31T23:59:00", "2026-08-31")).toBe("2026-08-31T23:58:00");
    expect(bookAt("2026-09-01T00:00:00", "2026-08-31")).toBe("2026-08-31T23:59:00");
    expect(bookAt(null, "2026-09-30")).toBe("2026-09-30T23:58:00");
  });
  it("toIikoTimestamp принимает формат postgres", () => {
    expect(toIikoTimestamp("2026-08-31 23:58:00")).toBe("2026-08-31T23:58:00");
    expect(toIikoTimestamp("2026-08-31T23:58:00")).toBe("2026-08-31T23:58:00");
  });
  it("toIikoDate, nextDay, previousPeriods", () => {
    expect(toIikoDate("2026-08-31")).toBe("31.08.2026");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(previousPeriods("2027-02-28", 3)).toEqual(["2027-01-31", "2026-12-31", "2026-11-30"]);
  });
});

describe("unitCost", () => {
  it("из корректировки, иначе из учёта, иначе нет", () => {
    expect(unitCost({ qty: -38, sum: -19181 }, { amount: 38, sum: 999 })).toEqual({ cost: 504.7632, source: "correction" });
    expect(unitCost({ qty: 0, sum: 0 }, { amount: 2, sum: 10375 })).toEqual({ cost: 5187.5, source: "balance" });
    expect(unitCost(undefined, { amount: -0.052, sum: -7885 })).toEqual({ cost: null, source: null });
    expect(unitCost(undefined, { amount: 3, sum: 0 })).toEqual({ cost: null, source: null });
    expect(unitCost(undefined, undefined)).toEqual({ cost: null, source: null });
  });
});

describe("buildLines + totals", () => {
  const meta = new Map([
    ["p3", { name: "Перец", unit_name: "кг", group_name: "Склад / Приправы" }],
    ["p4", { name: "Стаканы", unit_name: "шт", group_name: "Chopar / Коробки" }],
  ]);

  it("объединение: админка ∪ ненулевой учёт ∪ ненулевая корректировка; B = C + корр", () => {
    const lines = buildLines({
      admin: [
        { product_id: "p1", product_name: "Вода", unit_name: "шт", group_name: "Напитки", qty: 20, state: "counted", counts_n: 1 },
        { product_id: "p2", product_name: "Соль", unit_name: "кг", group_name: "Склад", qty: null, state: "skipped", counts_n: 2 },
      ],
      book: [
        { product_id: "p1", amount: 15, sum: 24765 },
        { product_id: "p3", amount: 0, sum: 0 }, // ноль и не в админке — строки нет
        { product_id: "p4", amount: -43, sum: 0 },
      ],
      corrections: [
        { product_id: "p1", product_name: "Вода", qty: 9, sum: 14860 },
        { product_id: "p4", product_name: "Стаканы", qty: 43, sum: 0 },
      ],
      meta,
    });
    expect(lines.map((l) => l.product_id).sort()).toEqual(["p1", "p2", "p4"]);
    const p1 = lines.find((l) => l.product_id === "p1")!;
    expect(p1.iiko_fact_qty).toBe(24);
    expect(p1.admin_qty).toBe(20);
    expect(p1.diff_ab_qty).toBe(-4);
    expect(p1.unit_cost).toBe(1651.1111);
    expect(p1.cost_source).toBe("correction");
    expect(p1.diff_ab_sum).toBe(-6604.44);
    expect(p1.diff_ac_sum).toBe(8255.56);
    const p2 = lines.find((l) => l.product_id === "p2")!;
    expect(p2.admin_state).toBe("skipped");
    expect(p2.admin_qty).toBeNull();
    expect(p2.diff_ab_qty).toBeNull();
    expect(p2.admin_counts_n).toBe(2);
    const p4 = lines.find((l) => l.product_id === "p4")!;
    expect(p4.admin_state).toBe("absent");
    expect(p4.product_name).toBe("Стаканы");
    expect(p4.iiko_fact_qty).toBe(0);
    expect(p4.unit_cost).toBeNull();

    const t = totals(lines, true);
    expect(t).toEqual({ lines_total: 3, mismatch_ab_count: 1, diff_ab_sum: -6604.44, diff_ac_sum: 8255.56, diff_bc_sum: 14860 });
  });

  it("без документа iiko: B нет, A − C считается", () => {
    const lines = buildLines({
      admin: [{ product_id: "p1", product_name: "Вода", unit_name: "шт", group_name: "Напитки", qty: 10, state: "counted", counts_n: 1 }],
      book: [{ product_id: "p1", amount: 12, sum: 1200 }],
      corrections: null,
      meta,
    });
    expect(lines[0].iiko_fact_qty).toBeNull();
    expect(lines[0].diff_ab_qty).toBeNull();
    expect(lines[0].diff_ac_sum).toBe(-200);
    expect(totals(lines, false).diff_bc_sum).toBeNull();
  });

  it("дроби без хвостов float: 0.1 + 0.2 = 0.3", () => {
    const lines = buildLines({
      admin: [{ product_id: "p1", product_name: "Сироп", unit_name: "л", group_name: "Склад", qty: 0.3, state: "counted", counts_n: 1 }],
      book: [{ product_id: "p1", amount: 0.1, sum: 100 }],
      corrections: [{ product_id: "p1", product_name: "Сироп", qty: 0.2, sum: 200 }],
      meta,
    });
    expect(lines[0].iiko_fact_qty).toBe(0.3);
    expect(lines[0].diff_ab_qty).toBe(0);
    expect(totals(lines, true).mismatch_ab_count).toBe(0);
  });

  it("totalsToDb / sameTotals", () => {
    const a = totalsToDb({ lines_total: 2, mismatch_ab_count: 1, diff_ab_sum: -5, diff_ac_sum: null, diff_bc_sum: 10.5 });
    expect(a).toEqual({ lines_total: 2, mismatch_ab_count: 1, diff_ab_sum: "-5.00", diff_ac_sum: null, diff_bc_sum: "10.50" });
    expect(sameTotals({ ...a, diff_ab_sum: "-5.0" }, a)).toBe(true);
    expect(sameTotals({ ...a, mismatch_ab_count: 2 }, a)).toBe(false);
    expect(sameTotals(null, a)).toBe(false);
  });
});

describe("diffCorrections", () => {
  it("изменённые, новые и пропавшие строки; нулевая vs отсутствующая — не изменение", () => {
    const before = [
      { product_id: "p1", product_name: "Вода", qty: 9, sum: 1 },
      { product_id: "p2", product_name: "Соль", qty: -1, sum: -1 },
      { product_id: "p3", product_name: "Перец", qty: 0, sum: 0 },
    ];
    const after = [
      { product_id: "p1", product_name: "Вода", qty: 7, sum: 1 },
      { product_id: "p4", product_name: "Сахар", qty: 2, sum: 2 },
    ];
    expect(diffCorrections(before, after)).toEqual([
      { product_id: "p1", product_name: "Вода", qty_before: 9, qty_after: 7 },
      { product_id: "p2", product_name: "Соль", qty_before: -1, qty_after: null },
      { product_id: "p4", product_name: "Сахар", qty_before: null, qty_after: 2 },
    ]);
  });
});
