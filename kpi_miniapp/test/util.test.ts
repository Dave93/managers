import { expect, it } from "bun:test";
import { capFirst, latch, reasonCount } from "../src/util";

it("latch: take один раз, release возвращает", () => {
  const l = latch();
  expect([l.take(), l.take()]).toEqual([true, false]);
  l.release();
  expect(l.take()).toBe(true);
});
it("capFirst и reasonCount", () => {
  expect([capFirst("noyabrdagi"), capFirst("")]).toEqual(["Noyabrdagi", ""]);
  expect([reasonCount("  ок!! "), reasonCount("18 окт"), reasonCount("")]).toEqual([2, 5, 0]);
});
