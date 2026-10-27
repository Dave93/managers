import { describe, expect, it } from "bun:test";
import { matchesName, searchWords } from "./name-search";

const povar = { first_name: "Тест", last_name: "Повар" };

describe("поиск сотрудника по ФИО", () => {
  it("слова запроса в любом порядке", () => {
    expect(matchesName(searchWords("Тест Повар"), povar)).toBe(true);
    expect(matchesName(searchWords("Повар Тест"), povar)).toBe(true);
    expect(matchesName(searchWords("  повар   тест "), povar)).toBe(true);
  });
  it("одно слово и часть слова — как раньше", () => {
    expect(matchesName(searchWords("Повар"), povar)).toBe(true);
    expect(matchesName(searchWords("пов"), povar)).toBe(true);
    expect(matchesName(searchWords("ест"), povar)).toBe(true);
  });
  it("без учёта регистра", () => {
    expect(matchesName(searchWords("ТЕСТ повар"), povar)).toBe(true);
  });
  it("нужны все слова", () => {
    expect(matchesName(searchWords("Тест Кассир"), povar)).toBe(false);
    expect(matchesName(searchWords("Второй Повар"), povar)).toBe(false);
  });
  it("слово не склеивается из конца имени и начала фамилии", () => {
    expect(matchesName(searchWords("тпов"), povar)).toBe(false);
    expect(matchesName(searchWords("стпо"), povar)).toBe(false);
  });
  it("«ё» и «е» равны в обе стороны", () => {
    const fyodor = { first_name: "Фёдор", last_name: "Семёнов" };
    expect(matchesName(searchWords("федор семенов"), fyodor)).toBe(true);
    expect(matchesName(searchWords("СЕМЁНОВ"), fyodor)).toBe(true);
    expect(matchesName(searchWords("Алёна"), { first_name: "Алена", last_name: "Ким" })).toBe(true);
  });
  it("пустой запрос — без фильтра", () => {
    expect(searchWords("   ")).toEqual([]);
    expect(matchesName([], povar)).toBe(true);
  });
});
