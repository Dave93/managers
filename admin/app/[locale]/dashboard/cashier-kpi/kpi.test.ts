/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { toRankedRows, networkAverage, activeCashiers, MIN_ORDERS_FOR_AVG } from "./kpi";
import type { CashierKpi } from "./types";

let n = 0;
const cashier = (over: Partial<CashierKpi> = {}): CashierKpi => ({
  cashier_id: `c${++n}`,
  cashier_name: "Alice",
  cashier_code: null,
  terminal_name: "Chorsu",
  shifts: 1,
  orders: 30,
  revenue: 300_000,
  hours: 8,
  avg_check: 10_000,
  orders_per_hour: 3.75,
  revenue_per_hour: 37_500,
  prev: null,
  ...over,
});

describe("toRankedRows", () => {
  test("picks the value by metric", () => {
    const rows = toRankedRows(
      [cashier({ cashier_name: "A", revenue: 100, avg_check: 5, orders_per_hour: 1 })],
      "avg_check"
    );
    expect(rows).toEqual([{ name: "A", current: 5, previous: null }]);
  });

  test("drops rows below minOrders", () => {
    const low = cashier({ cashier_name: "Low", orders: 5 });
    const high = cashier({ cashier_name: "High", orders: 40 });
    const rows = toRankedRows([low, high], "revenue", { minOrders: MIN_ORDERS_FOR_AVG });
    expect(rows.map((r) => r.name)).toEqual(["High"]);
  });

  test("default minOrders keeps everyone, including zero-order rows", () => {
    const zero = cashier({ cashier_name: "Zero", orders: 0 });
    const rows = toRankedRows([zero], "revenue");
    expect(rows.map((r) => r.name)).toEqual(["Zero"]);
  });

  test("sorts desc by current and slices to limit", () => {
    const rows = toRankedRows(
      [
        cashier({ cashier_name: "A", revenue: 100 }),
        cashier({ cashier_name: "B", revenue: 300 }),
        cashier({ cashier_name: "C", revenue: 200 }),
      ],
      "revenue",
      { limit: 2 }
    );
    expect(rows.map((r) => r.name)).toEqual(["B", "C"]);
  });

  test("disambiguates shared names with the terminal name", () => {
    const rows = toRankedRows(
      [
        cashier({ cashier_name: "Kассир1", terminal_name: "Chorsu", revenue: 200 }),
        cashier({ cashier_name: "Kассир1", terminal_name: "Yunusabad", revenue: 100 }),
        cashier({ cashier_name: "Bob", terminal_name: "Chorsu", revenue: 50 }),
      ],
      "revenue"
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Kассир1 · Chorsu",
      "Kассир1 · Yunusabad",
      "Bob",
    ]);
  });

  test("falls back to '?' when a duplicate name has no terminal", () => {
    const rows = toRankedRows(
      [
        cashier({ cashier_name: "Dup", terminal_name: null, revenue: 200 }),
        cashier({ cashier_name: "Dup", terminal_name: "Chorsu", revenue: 100 }),
      ],
      "revenue"
    );
    expect(rows.map((r) => r.name)).toEqual(["Dup · ?", "Dup · Chorsu"]);
  });

  test("does not disambiguate a duplicate that limit sliced away", () => {
    const rows = toRankedRows(
      [
        cashier({ cashier_name: "Dup", terminal_name: "A", revenue: 300 }),
        cashier({ cashier_name: "Dup", terminal_name: "B", revenue: 10 }),
        cashier({ cashier_name: "Solo", revenue: 200 }),
      ],
      "revenue",
      { limit: 2 }
    );
    expect(rows.map((r) => r.name)).toEqual(["Dup", "Solo"]);
  });

  test("previous is null when prev is null, and the metric value otherwise", () => {
    const withPrev = cashier({
      cashier_name: "P",
      revenue: 500,
      prev: {
        shifts: 1,
        orders: 20,
        revenue: 400,
        hours: 6,
        avg_check: 20_000,
        orders_per_hour: 3.3,
        revenue_per_hour: 66_000,
      },
    });
    const withoutPrev = cashier({ cashier_name: "NP", revenue: 500, prev: null });
    const rows = toRankedRows([withPrev, withoutPrev], "revenue");
    expect(rows.find((r) => r.name === "P")?.previous).toBe(400);
    expect(rows.find((r) => r.name === "NP")?.previous).toBeNull();
  });

  test("empty input yields an empty array", () => {
    expect(toRankedRows([], "revenue")).toEqual([]);
  });
});

describe("networkAverage", () => {
  test("avg_check is sum(revenue)/sum(orders) over kept rows", () => {
    const cashiers = [
      cashier({ revenue: 300_000, orders: 30 }),
      cashier({ revenue: 200_000, orders: 10 }),
    ];
    // (300000+200000)/(30+10) = 12500, not the plain mean of the two avg_checks
    expect(networkAverage(cashiers, "avg_check")).toBe(12_500);
  });

  test("avg_check respects minOrders", () => {
    const kept = cashier({ revenue: 300_000, orders: 30 });
    const dropped = cashier({ revenue: 1_000_000, orders: 1 });
    expect(networkAverage([kept, dropped], "avg_check", MIN_ORDERS_FOR_AVG)).toBe(10_000);
  });

  test("orders_per_hour is sum(orders)/sum(hours) over kept rows", () => {
    const cashiers = [
      cashier({ orders: 30, hours: 10 }),
      cashier({ orders: 10, hours: 10 }),
    ];
    expect(networkAverage(cashiers, "orders_per_hour")).toBe(2);
  });

  test("revenue is the plain mean", () => {
    const cashiers = [cashier({ revenue: 100 }), cashier({ revenue: 300 })];
    expect(networkAverage(cashiers, "revenue")).toBe(200);
  });

  test("empty input is 0, not NaN", () => {
    expect(networkAverage([], "revenue")).toBe(0);
    expect(networkAverage([], "avg_check")).toBe(0);
    expect(networkAverage([], "orders_per_hour")).toBe(0);
  });
});

describe("activeCashiers", () => {
  test("counts cashiers who actually worked a shift", () => {
    const cashiers = [cashier({ shifts: 1 }), cashier({ shifts: 0 }), cashier({ shifts: 2 })];
    expect(activeCashiers(cashiers)).toBe(2);
  });

  test("empty input is 0", () => {
    expect(activeCashiers([])).toBe(0);
  });
});
