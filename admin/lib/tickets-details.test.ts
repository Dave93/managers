/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { detailValue } from "./tickets-details";

describe("detailValue", () => {
  test("обычный ключ отдаёт значение", () => {
    expect(detailValue({ room: "12" }, "room")).toBe("12");
    expect(detailValue({ count: 3 }, "count")).toBe(3);
  });

  test("отсутствующий ключ даёт undefined", () => {
    expect(detailValue({ room: "12" }, "floor")).toBeUndefined();
  });

  // Ключ схемы — любой snake_case, в том числе совпадающий с членом
  // Object.prototype. details[key] вернул бы функцию, и карточка напечатала бы
  // её исходный текст вместо «—».
  test.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "унаследованный ключ %s даёт undefined",
    (key) => {
      expect(detailValue({ room: "12" }, key)).toBeUndefined();
      expect(detailValue({}, key)).toBeUndefined();
    }
  );

  test("собственное свойство с именем из прототипа читается", () => {
    expect(detailValue({ constructor: "Alpha" }, "constructor")).toBe("Alpha");
    expect(detailValue(JSON.parse('{"__proto__": 5}'), "__proto__")).toBe(5);
  });

  test("ложные значения возвращаются как есть, а не подменяются", () => {
    const details = { zero: 0, empty: "", no: false, nothing: null };
    expect(detailValue(details, "zero")).toBe(0);
    expect(detailValue(details, "empty")).toBe("");
    expect(detailValue(details, "no")).toBe(false);
    expect(detailValue(details, "nothing")).toBeNull();
  });

  test("details нет вовсе: undefined, без исключения", () => {
    expect(detailValue(null, "room")).toBeUndefined();
    expect(detailValue(undefined, "room")).toBeUndefined();
  });

  test("details не объект: undefined", () => {
    expect(detailValue("room" as unknown as Record<string, unknown>, "room")).toBeUndefined();
    expect(detailValue(7 as unknown as Record<string, unknown>, "toFixed")).toBeUndefined();
  });
});
