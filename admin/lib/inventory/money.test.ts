import { describe, expect, it } from "bun:test";
import { formatDiff, formatQty } from "./money";

const _ = "\u202F"; // узкий неразрывный пробел — разделитель тысяч

describe("formatQty", () => {
  it("до 3 знаков, без хвостовых нулей", () => {
    expect(formatQty("24.0000")).toBe("24");
    expect(formatQty("-0.1170")).toBe("−0,117");
    expect(formatQty("1234.5")).toBe(`1${_}234,5`);
    expect(formatQty(null)).toBe("—");
  });
});

describe("formatDiff", () => {
  it("со знаком: плюс — в админке больше, минус — меньше; ноль и пусто", () => {
    expect(formatDiff("2.0000")).toBe("+2");
    expect(formatDiff("-4")).toBe("−4");
    expect(formatDiff("-0.1170")).toBe("−0,117");
    expect(formatDiff("0.0000")).toBe("0");
    expect(formatDiff(null)).toBe("—");
  });
});
