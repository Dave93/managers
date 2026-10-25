import { describe, expect, it } from "bun:test";
import { ITEM_SOURCE_OPTIONS, assignBody, assignValue, cardAssignLabel, cardCodeOk, parseRoleCodes } from "./settings";

describe("карты", () => {
  it("parseRoleCodes", () => {
    expect(parseRoleCodes("cook, universal_cook\nCOOK  ")).toEqual(["cook", "universal_cook"]);
    expect(parseRoleCodes(" , ")).toEqual([]);
  });
  it("cardCodeOk", () => {
    for (const ok of ["cook", "cashier_plus", "c2"]) expect(cardCodeOk(ok)).toBe(true);
    for (const bad of ["", "c", "Cook", "2cook", "повар", "a".repeat(41)]) expect(cardCodeOk(bad)).toBe(false);
  });
  it("источники: данные есть только у ручного", () => {
    expect(ITEM_SOURCE_OPTIONS.map((o) => [o.value, o.ready])).toEqual([
      ["manual", true], ["attendance", false], ["cooking_speed", false], ["sales_plan", false], ["food_cost", false],
    ]);
  });
});

describe("карта сотрудника", () => {
  const card = { id: "c-cl", code: "cleaner", title_ru: "Техничка" };
  it("assignValue и assignBody", () => {
    expect(assignValue({ card, card_source: "override" })).toBe("c-cl");
    expect(assignValue({ card: null, card_source: "override" })).toBe("none");
    expect(assignValue({ card, card_source: "role" })).toBe("auto");
    expect(assignValue({ card: null, card_source: null })).toBe("auto");
    expect(assignBody("auto")).toBe("auto");
    expect(assignBody("none")).toBeNull();
    expect(assignBody("c-cl")).toBe("c-cl");
  });
  it("cardAssignLabel", () => {
    expect(cardAssignLabel({ card, card_source: "override" })).toBe("Вручную: Техничка");
    expect(cardAssignLabel({ card: null, card_source: "override" })).toBe("Не оценивается");
    expect(cardAssignLabel({ card: { ...card, title_ru: "Повар" }, card_source: "role" })).toBe("По должности: Повар");
    expect(cardAssignLabel({ card: null, card_source: null })).toBe("Нет карты");
  });
});
