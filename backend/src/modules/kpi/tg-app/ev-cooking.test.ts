import { describe, expect, it } from "bun:test";
import { shapeCooking, shiftOf } from "./ev-cooking";

const day = (d: string | null, orders: number, on_time: number, avg_wait: number, median_wait: number, median_ratio: number | null = 1) => ({ day: d, orders, on_time, avg_wait, median_wait, median_ratio });

describe("shapeCooking", () => {
  it("итог — строка без дня (медиана по всем заказам), дни по порядку; блюда от самого долгого", () => {
    const r = shapeCooking(
      [day("2025-10-10", 3, 2, 500, 480), day("2025-10-11", 1, 0, 900, 900), day(null, 4, 2, 600, 540, 1.1)],
      [
        { name: "Паста", qty: 6, avg_wait: 400, over: 0 },
        { name: "Пицца", qty: 9, avg_wait: 533, over: 3 },
      ]
    );
    expect(r.summary).toEqual({ orders: 4, on_time: 2, avg_wait_sec: 600, median_wait_sec: 540 });
    expect(r.days).toEqual([
      { day: "2025-10-10", orders: 3, on_time: 2, avg_wait_sec: 500, median_wait_sec: 480 },
      { day: "2025-10-11", orders: 1, on_time: 0, avg_wait_sec: 900, median_wait_sec: 900 },
    ]);
    expect(r.dishes.map((d) => d.name)).toEqual(["Пицца", "Паста"]);
    expect(r.dishes[0]).toEqual({ name: "Пицца", qty: 9, avg_wait_sec: 533, over_pct: 33.3 });
    expect(r.data_issue).toBeNull();
  });

  it("без заказов итога нет: пустой ввод и пустая строка итога (GROUPING SETS отдаёт её всегда)", () => {
    expect(shapeCooking([], []).summary).toBeNull();
    const empty = shapeCooking([day(null, 0, 0, 0, 0, null)], [], true);
    expect(empty).toEqual({ summary: null, days: [], dishes: [], data_issue: null });
  });

  it("данные под сомнением: без кухни в iiko — no_kitchen; обычное ожидание больше двух нормативов — too_slow", () => {
    const rows = [day("2025-10-10", 2, 0, 7000, 7100, 5.9), day(null, 2, 0, 7000, 7100, 5.9)];
    expect(shapeCooking(rows, [], true).data_issue).toBe("no_kitchen");
    expect(shapeCooking(rows, [], false).data_issue).toBe("too_slow");
    expect(shapeCooking([day(null, 2, 1, 900, 900, 2)], []).data_issue).toBeNull(); // ровно два норматива — ещё не подозрительно
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
