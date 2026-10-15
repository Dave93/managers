import { describe, expect, it } from "bun:test";
import { columnsFor, isSigned, cellOf } from "./turnover";

describe("turnover helpers", () => {
  const cols = [{ key: "start" }, { key: "transfer" }, { key: "cost_correction", sum_only: true }, { key: "end" }] as const;
  it("режим «Количество» прячет sum_only", () => {
    expect(columnsFor([...cols], "qty").map((c) => c.key)).toEqual(["start", "transfer", "end"]);
    expect(columnsFor([...cols], "sum").map((c) => c.key)).toEqual(["start", "transfer", "cost_correction", "end"]);
  });
  it("± колонки — со знаком, расход и остатки — без", () => {
    expect(isSigned("transfer")).toBe(true);
    expect(isSigned("inventory")).toBe(true);
    expect(isSigned("sales")).toBe(false);
    expect(isSigned("end")).toBe(false);
  });
  it("cellOf — нет значения → 0", () => {
    expect(cellOf({ qty: { start: "5" } } as any, "start", "qty")).toBe("5");
    expect(cellOf({ qty: {} } as any, "invoice", "qty")).toBe("0");
    expect(cellOf({ qty: {}, sum: { end: "7" } } as any, "end", "sum")).toBe("7");
  });
});
