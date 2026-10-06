import { describe, expect, it } from "bun:test";
import { formatMoney, formatQty } from "./money";

const _ = "\u202F"; // узкий неразрывный пробел — разделитель тысяч

describe("formatMoney", () => {
  it("целые сумы с узкими пробелами, минус — настоящий минус, null — тире", () => {
    expect(formatMoney("-9905579.00")).toBe(`−9${_}905${_}579`);
    expect(formatMoney(14379599)).toBe(`14${_}379${_}599`);
    expect(formatMoney("0.40")).toBe("0");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatQty", () => {
  it("до 3 знаков, без хвостовых нулей", () => {
    expect(formatQty("24.0000")).toBe("24");
    expect(formatQty("-0.1170")).toBe("−0,117");
    expect(formatQty("1234.5")).toBe(`1${_}234,5`);
    expect(formatQty(null)).toBe("—");
  });
});
