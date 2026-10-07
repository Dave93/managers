import { describe, expect, it } from "bun:test";
import { formatQty } from "./money";

const _ = "\u202F"; // узкий неразрывный пробел — разделитель тысяч

describe("formatQty", () => {
  it("до 3 знаков, без хвостовых нулей", () => {
    expect(formatQty("24.0000")).toBe("24");
    expect(formatQty("-0.1170")).toBe("−0,117");
    expect(formatQty("1234.5")).toBe(`1${_}234,5`);
    expect(formatQty(null)).toBe("—");
  });
});
