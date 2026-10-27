import { describe, expect, it } from "bun:test";
import { formatPct, formatSum, formatTashkent, parseAmount } from "./format";

describe("format", () => {
  it("formatTashkent не зависит от зоны браузера", () => {
    expect(formatTashkent("2026-11-07T18:59:59.999Z")).toBe("07.11.2026 23:59");
    expect(formatTashkent("2026-11-07T18:59:59.999Z", false)).toBe("07.11.2026");
    expect(formatTashkent("2026-10-01")).toBe("01.10.2026");
    expect(formatTashkent(null)).toBe("—");
  });
  it("formatPct", () => {
    expect(formatPct(83.33)).toBe("83,33\u00a0%");
    expect(formatPct(94)).toBe("94\u00a0%");
    expect(formatPct(90.5)).toBe("90,5\u00a0%");
    expect(formatPct(null)).toBe("—");
  });
  it("formatSum", () => {
    expect(formatSum(300000)).toBe("300\u00a0000\u00a0сум");
    expect(formatSum(1500)).toBe("1\u00a0500\u00a0сум");
    expect(formatSum(0)).toBe("0\u00a0сум");
    expect(formatSum(null)).toBe("—");
  });
  it("parseAmount", () => {
    expect(parseAmount("300 000")).toBe(300000);
    expect(parseAmount("300\u00a0000")).toBe(300000);
    expect(parseAmount("0")).toBe(0);
    for (const bad of ["", "  ", "-5", "1.5", "abc"]) expect(parseAmount(bad)).toBeNull();
  });
});
