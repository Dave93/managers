import { describe, expect, test } from "bun:test";
import { formatQty, parseQtyInput, sumQty } from "./qty";

describe("parseQtyInput", () => {
  test("одно число с запятой или точкой", () => {
    expect(parseQtyInput("2,5")).toEqual({ ok: true, values: [2.5] });
    expect(parseQtyInput("2.5")).toEqual({ ok: true, values: [2.5] });
    expect(parseQtyInput("0")).toEqual({ ok: true, values: [0] });
  });
  test("сумма через плюс с пробелами — несколько записей", () => {
    expect(parseQtyInput(" 2,5 + 3 ")).toEqual({ ok: true, values: [2.5, 3] });
    expect(parseQtyInput("1+1+0,25")).toEqual({ ok: true, values: [1, 1, 0.25] });
  });
  test("ошибки", () => {
    expect(parseQtyInput("")).toEqual({ ok: false, error: "empty" });
    expect(parseQtyInput("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseQtyInput("-1")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("2,5+")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseQtyInput("1,23456")).toEqual({ ok: false, error: "too_many_decimals" });
    expect(parseQtyInput("1000001")).toEqual({ ok: false, error: "too_big" });
  });
});

describe("sumQty / formatQty", () => {
  test("точная десятичная сумма", () => {
    expect(sumQty([0.1, 0.2])).toBe("0.3");
    expect(sumQty(["2.5000", 3])).toBe("5.5");
    expect(sumQty([])).toBe("0");
    expect(sumQty(["1.2345", "0.0001"])).toBe("1.2346");
  });
  test("формат с запятой", () => {
    expect(formatQty("5.5")).toBe("5,5");
    expect(formatQty("5.5000")).toBe("5,5");
    expect(formatQty("12")).toBe("12");
    expect(formatQty(null)).toBe("");
  });
});
