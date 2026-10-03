import { describe, test, expect } from "bun:test";
import { maskRanking } from "../../src/modules/charts/terminal-scope";

const rows = [
  { name: "X", rank: 1, restaurant_group_id: "g1", department_id: "d1", current_revenue: 300, previous_revenue: 200 },
  { name: "Own", rank: 2, restaurant_group_id: "g2", department_id: "d1", current_revenue: 200, previous_revenue: null },
  { name: "Own2", rank: 3, restaurant_group_id: "g3", department_id: "d1", current_revenue: 100, previous_revenue: 50 },
  { name: "Y", rank: 4, restaurant_group_id: "g4", department_id: "d2", current_revenue: 50, previous_revenue: 40 },
];
const keys = ["current_revenue", "previous_revenue"] as const;

describe("maskRanking", () => {
  test("own rows keep values, others are nulled, rank preserved, ids stripped", () => {
    const r = maskRanking(rows, ["g2", "g3"], keys);
    expect(r.total).toBe(4);
    expect(r.data).toEqual([
      { name: "X", rank: 1, own: false, current_revenue: null, previous_revenue: null },
      { name: "Own", rank: 2, own: true, current_revenue: 200, previous_revenue: null },
      { name: "Own2", rank: 3, own: true, current_revenue: 100, previous_revenue: 50 },
      { name: "Y", rank: 4, own: false, current_revenue: null, previous_revenue: null },
    ]);
    for (const row of r.data) {
      expect(row).not.toHaveProperty("restaurant_group_id");
      expect(row).not.toHaveProperty("department_id");
    }
  });

  test("own_brands is distinct department ids of own rows", () => {
    expect(maskRanking(rows, ["g2", "g3"], keys).own_brands).toEqual(["d1"]);
    expect(maskRanking(rows, ["g1", "g4"], keys).own_brands).toEqual(["d1", "d2"]);
    expect(maskRanking(rows, [], keys).own_brands).toEqual([]);
  });

  test("null ownIikoIds means unrestricted: all own, no brands", () => {
    const r = maskRanking(rows, null, keys);
    expect(r.data.every((x) => x.own)).toBe(true);
    expect(r.data[0]).toEqual({ name: "X", rank: 1, own: true, current_revenue: 300, previous_revenue: 200 });
    expect(r.own_brands).toEqual([]);
    expect(r.total).toBe(4);
  });
});
