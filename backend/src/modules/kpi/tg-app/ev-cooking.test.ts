import { describe, expect, it } from "bun:test";
import { shapeCooking, shiftOf } from "./ev-cooking";

describe("shapeCooking", () => {
  it("итог — сумма дней, среднее взвешено заказами; блюда от самого долгого", () => {
    const r = shapeCooking(
      [
        { day: "2025-10-10", orders: 3, on_time: 2, avg_wait: 500 },
        { day: "2025-10-11", orders: 1, on_time: 0, avg_wait: 900 },
      ],
      [
        { name: "Паста", qty: 6, avg_wait: 400, over: 0 },
        { name: "Пицца", qty: 9, avg_wait: 533, over: 3 },
      ]
    );
    expect(r.summary).toEqual({ orders: 4, on_time: 2, avg_wait_sec: 600 });
    expect(r.dishes.map((d) => d.name)).toEqual(["Пицца", "Паста"]);
    expect(r.dishes[0]).toEqual({ name: "Пицца", qty: 9, avg_wait_sec: 533, over_pct: 33.3 });
  });

  it("без заказов итога нет", () => {
    expect(shapeCooking([], []).summary).toBeNull();
  });
});

describe("shiftOf", () => {
  it("1 и 2 принимаются, пусто — весь день, остальное — 422 bad_shift", () => {
    expect(shiftOf("1")).toBe("1");
    expect(shiftOf("2")).toBe("2");
    expect(shiftOf(undefined)).toBeNull();
    expect(shiftOf("")).toBeNull();
    expect(() => shiftOf("3")).toThrow();
  });
});
