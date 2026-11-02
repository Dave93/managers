import { describe, expect, it } from "bun:test";
import { nameKey, worklyNameKeys } from "./names";

describe("workly/names: nameKey", () => {
  it("регистр, апострофы и порядок слов не важны", () => {
    // Выдуманное имя: прямой апостроф в имени, типографский в фамилии, разный регистр.
    expect(nameKey("To'lqin", "O’RINBOYEV")).toBe(nameKey("orinboyev", "TOLQIN"));
    expect(nameKey("To'lqin", "O’RINBOYEV")).toBe("ORINBOYEV TOLQIN");
  });

  it("все семь видов апострофа удаляются, а не заменяются пробелом", () => {
    for (const a of ["’", "‘", "ʻ", "ʼ", "`", "´", "'"]) {
      expect(nameKey(`O${a}ktam`, "Aka")).toBe("AKA OKTAM");
    }
  });

  it("пустые и пропущенные части игнорируются", () => {
    expect(nameKey("A", null, "")).toBe(nameKey("A"));
    expect(nameKey(undefined, "A", "  ")).toBe("A");
  });

  it("токены уникальны и отсортированы", () => {
    expect(nameKey("B", "A", "B")).toBe("A B");
  });

  it("всё кроме A-Z0-9А-ЯЁ становится пробелом", () => {
    expect(nameKey("Anna-Maria", "O.Smith")).toBe("ANNA MARIA O SMITH");
  });

  it("кириллица: регистр и Ё сохраняются в ключе", () => {
    expect(nameKey("иван", "Пётр")).toBe("ИВАН ПЁТР");
  });

  it("имя без букв даёт пустой ключ", () => {
    expect(nameKey("", null, " - ")).toBe("");
  });
});

describe("workly/names: worklyNameKeys", () => {
  it("с отчеством два различных ключа", () => {
    const keys = worklyNameKeys({ first_name: "A", last_name: "B", patronymic: "C" });
    expect(keys).toEqual(["A B", "A B C"]);
  });

  it("без отчества один ключ", () => {
    expect(worklyNameKeys({ first_name: "A", last_name: "B" })).toEqual(["A B"]);
    expect(worklyNameKeys({ first_name: "A", last_name: "B", patronymic: "" })).toEqual(["A B"]);
    expect(worklyNameKeys({ first_name: "A", last_name: "B", patronymic: null })).toEqual(["A B"]);
  });

  it("отчество, уже входящее в имя, не даёт второй ключ", () => {
    expect(worklyNameKeys({ first_name: "A", last_name: "B", patronymic: "A" })).toEqual(["A B"]);
  });
});
