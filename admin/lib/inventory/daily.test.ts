import { describe, expect, test } from "bun:test";
import { shortStoreName } from "./daily";

describe("shortStoreName", () => {
  test("убирает «- Склад Les/Chopar», оставляя код и название", () => {
    expect(shortStoreName("21002 - Склад Chopar Новые сергили")).toBe("21002 Новые сергили");
    expect(shortStoreName("19037 - Склад Les Scopus (Farxadskiy)")).toBe("19037 Scopus (Farxadskiy)");
  });
  test("«Les Ailes Бухара» — бренд не обрезается наполовину", () => {
    expect(shortStoreName("19016 - Склад Les Ailes Бухара")).toBe("19016 Les Ailes Бухара");
  });
  test("непохожее название — как есть", () => {
    expect(shortStoreName("19999 Тест")).toBe("19999 Тест");
  });
});
