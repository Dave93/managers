/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { rankSummary } from "./rank-summary";

describe("rankSummary", () => {
  test("no own rows", () => {
    expect(rankSummary([], 64)).toBe("Нет привязанных филиалов");
  });

  test("one own row", () => {
    expect(rankSummary([{ name: "Chirchiq", rank: 7 }], 64)).toBe("Ваше место: 7 из 64");
  });

  test("several own rows, sorted by rank", () => {
    expect(
      rankSummary(
        [
          { name: "Depo", rank: 31 },
          { name: "Chirchiq", rank: 7 },
        ],
        64
      )
    ).toBe("Chirchiq — 7, Depo — 31 из 64");
  });
});
