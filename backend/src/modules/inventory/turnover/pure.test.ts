import { describe, expect, it } from "bun:test";
import { InventoryError } from "../errors";
import { aggregate, branchMonthState, buildStoreSnapshot, columnOf, turnoverBounds, visibleColumns } from "./pure";

// 14.10.2026 10:00 по Ташкенту
const NOW = new Date("2026-10-14T05:00:00Z");

describe("columnOf", () => {
  it("известные типы и прочее", () => {
    expect(columnOf("INVOICE")).toBe("invoice");
    expect(columnOf("SESSION_WRITEOFF")).toBe("sales");
    expect(columnOf("STORE_COST_CORRECTION")).toBe("cost_correction");
    expect(columnOf("SOMETHING_NEW")).toBe("other");
  });
});

describe("turnoverBounds", () => {
  it("закрытый месяц — весь месяц, конец на 1-е следующего", () => {
    expect(turnoverBounds("2026-09-30", NOW)).toEqual({
      from: "2026-09-01", to: "2026-09-30", startAt: "2026-09-01T00:00:00", endAt: "2026-10-01T00:00:00",
    });
  });
  it("декабрь — конец на 1 января", () => {
    expect(turnoverBounds("2025-12-31", NOW)!.endAt).toBe("2026-01-01T00:00:00");
  });
  it("текущий месяц — по вчера", () => {
    expect(turnoverBounds("2026-10-31", NOW)).toEqual({
      from: "2026-10-01", to: "2026-10-13", startAt: "2026-10-01T00:00:00", endAt: "2026-10-14T00:00:00",
    });
  });
  it("1-е число текущего месяца — данных нет", () => {
    expect(turnoverBounds("2026-10-31", new Date("2026-10-01T03:00:00Z"))).toBeNull();
  });
  it("31.10 23:30 по Ташкенту — ещё октябрь (UTC 31.10 18:30)", () => {
    expect(turnoverBounds("2026-10-31", new Date("2026-10-31T18:30:00Z"))!.to).toBe("2026-10-30");
  });
  it("01.11 00:30 по Ташкенту — октябрь уже закрыт (UTC ещё 31.10)", () => {
    expect(turnoverBounds("2026-10-31", new Date("2026-10-31T19:30:00Z"))!.to).toBe("2026-10-31");
  });
  it("будущий и кривой месяц — 422", () => {
    expect(() => turnoverBounds("2026-11-30", NOW)).toThrow(InventoryError);
    expect(() => turnoverBounds("2026-09-15", NOW)).toThrow(InventoryError);
  });
});

describe("aggregate", () => {
  const txs = [
    { tx_type: "INVOICE", qty_in: 10, qty_out: 0, sum_in: 1000, sum_out: 0 },
    { tx_type: "SESSION_WRITEOFF", qty_in: 0, qty_out: 6, sum_in: 0, sum_out: 600 },
    { tx_type: "TRANSFER", qty_in: 2, qty_out: 3, sum_in: 200, sum_out: 300 },
    { tx_type: "INVENTORY_CORRECTION", qty_in: 0, qty_out: 1, sum_in: 0, sum_out: 100 },
    { tx_type: "STORE_COST_CORRECTION", qty_in: 0, qty_out: 0, sum_in: 5, sum_out: 0 },
    { tx_type: "NEW_TYPE", qty_in: 1, qty_out: 0, sum_in: 100, sum_out: 0 },
  ];
  it("расход положительным, ± со знаком, тождество", () => {
    const a = aggregate({ start_qty: 5, start_sum: 500, end_qty: 8, end_sum: 805 }, txs);
    expect(a.qty).toMatchObject({ start: 5, invoice: 10, sales: 6, transfer: -1, inventory: -1, other: 1, end: 8 });
    expect(a.sum).toMatchObject({ cost_correction: 5, sales: 600, end: 805 });
    expect(a.transfer).toEqual({ qty_in: 2, qty_out: 3, sum_in: 200, sum_out: 300 });
    expect(a.consistent).toBe(true);
  });
  it("не сходится по сумме больше чем на 1", () => {
    expect(aggregate({ start_qty: 5, start_sum: 500, end_qty: 8, end_sum: 807 }, txs).consistent).toBe(false);
  });
  it("без остатков — начало и конец 0", () => {
    const a = aggregate(undefined, [{ tx_type: "INVOICE", qty_in: 1, qty_out: 0, sum_in: 1, sum_out: 0 }]);
    expect(a.qty.start).toBe(0);
    expect(a.consistent).toBe(false);
  });
});

describe("visibleColumns", () => {
  const zero = aggregate({ start_qty: 1, start_sum: 1, end_qty: 1, end_sum: 1 }, []);
  it("всегда-колонки при нулях", () => {
    expect(visibleColumns([zero], true).map((c) => c.key)).toEqual(["start", "invoice", "sales", "transfer", "writeoff", "inventory", "end"]);
  });
  it("доп. колонки только если не ноль; cost_correction — sum_only и только с суммами", () => {
    const a = aggregate(undefined, [
      { tx_type: "PRODUCTION", qty_in: 1, qty_out: 0, sum_in: 1, sum_out: 0 },
      { tx_type: "STORE_COST_CORRECTION", qty_in: 0, qty_out: 0, sum_in: 3, sum_out: 0 },
    ]);
    expect(visibleColumns([a], true)).toContainEqual({ key: "cost_correction", sum_only: true });
    expect(visibleColumns([a], true).map((c) => c.key)).toContain("production");
    expect(visibleColumns([a], false).map((c) => c.key)).not.toContain("cost_correction");
  });
});

describe("buildStoreSnapshot", () => {
  it("только свой склад; товары с остатком или движением; consistent", () => {
    const s = buildStoreSnapshot(
      "s1",
      [{ store_id: "s1", product_id: "p1", amount: 5, sum: 50 }, { store_id: "s2", product_id: "p9", amount: 1, sum: 1 }],
      [{ store_id: "s1", product_id: "p1", amount: 7, sum: 70 }, { store_id: "s1", product_id: "p3", amount: 0, sum: 0 }],
      [
        { store_id: "s1", product_id: "p1", type: "INVOICE", qty_in: 2, qty_out: 0, sum_in: 20, sum_out: 0 },
        { store_id: "s1", product_id: "p2", type: "SESSION_WRITEOFF", qty_in: 0, qty_out: 1, sum_in: 0, sum_out: 10 },
      ]
    );
    expect(s.balances.map((b) => b.product_id).sort()).toEqual(["p1", "p2"]);
    expect(s.balances.find((b) => b.product_id === "p1")!.consistent).toBe(true);
    expect(s.balances.find((b) => b.product_id === "p2")!.consistent).toBe(false);
    expect(s.turnover).toHaveLength(2);
  });
});

describe("branchMonthState", () => {
  const none = { exists: false, changeable: false };
  const fixed = { exists: true, changeable: false };
  const open = { exists: true, changeable: true };
  it("текущий — закрыт всегда", () => {
    expect(branchMonthState("2026-10-31", NOW, fixed)).toEqual({ open: false, reason: "current" });
  });
  it("прошлый — только с зафиксированным пересчётом", () => {
    expect(branchMonthState("2026-09-30", NOW, none)).toEqual({ open: false, reason: "not_fixed" });
    expect(branchMonthState("2026-09-30", NOW, open)).toEqual({ open: false, reason: "not_fixed" });
    expect(branchMonthState("2026-09-30", NOW, fixed)).toEqual({ open: true, reason: null });
  });
  it("старше прошлого — открыт, если месячный пересчёт нельзя изменить", () => {
    expect(branchMonthState("2026-08-31", NOW, none)).toEqual({ open: true, reason: null });
    expect(branchMonthState("2026-08-31", NOW, fixed)).toEqual({ open: true, reason: null });
  });
  it("старше прошлого с черновиком или возвратом месячного — закрыт", () => {
    expect(branchMonthState("2026-08-31", NOW, open)).toEqual({ open: false, reason: "not_fixed" });
  });
});
