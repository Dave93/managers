/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { rankSummary } from "./rank-summary";

// Russian translator stub, mirrors messages/ru.json -> dashboardUi.rankSummary
const ru: Record<string, string> = {
  noOwnInBrand: "В этом бренде ваших филиалов нет",
  noOwnBranches: "Нет привязанных филиалов",
  ownPlace: "Ваше место: {rank} из {total}",
  ownPartsOfTotal: "{parts} из {total}",
};
const t = (key: string, values?: Record<string, string | number>) =>
  ru[key].replace(/\{(\w+)\}/g, (_, k) => String(values?.[k]));

describe("rankSummary", () => {
  test("no own rows", () => {
    expect(rankSummary([], 64, undefined, t)).toBe("Нет привязанных филиалов");
  });

  test("no own rows, brand selected", () => {
    expect(rankSummary([], 64, { brandSelected: true }, t)).toBe("В этом бренде ваших филиалов нет");
  });

  test("no own rows, no brand selected", () => {
    expect(rankSummary([], 64, { brandSelected: false }, t)).toBe("Нет привязанных филиалов");
  });

  test("one own row", () => {
    expect(rankSummary([{ name: "Chirchiq", rank: 7 }], 64, undefined, t)).toBe("Ваше место: 7 из 64");
  });

  test("several own rows, sorted by rank", () => {
    expect(
      rankSummary(
        [
          { name: "Depo", rank: 31 },
          { name: "Chirchiq", rank: 7 },
        ],
        64,
        undefined,
        t
      )
    ).toBe("Chirchiq — 7, Depo — 31 из 64");
  });
});
