import { describe, expect, it } from "bun:test";
import { locationKey, suggestTerminal } from "./locations";

describe("workly/locations: locationKey", () => {
  it("верхний регистр, всё кроме A-Z0-9 удаляется", () => {
    expect(locationKey("OFIS ")).toBe("OFIS");
    expect(locationKey("C-1")).toBe("C1");
    expect(locationKey("MEGA PLANET")).toBe("MEGAPLANET");
    expect(locationKey("KO'KCHA")).toBe("KOKCHA");
    expect(locationKey("m.gorkiy")).toBe("MGORKIY");
  });

  it("типографские апострофы удаляются, а не заменяются", () => {
    for (const a of ["’", "‘", "ʻ", "ʼ", "`", "´", "'"]) {
      expect(locationKey(`Qo${a}yliq-5`)).toBe("QOYLIQ5");
    }
  });

  it("пустая строка и строка без латиницы дают пустой ключ", () => {
    expect(locationKey("")).toBe("");
    expect(locationKey(" - ")).toBe("");
  });
});

describe("workly/locations: suggestTerminal", () => {
  const T = (id: string, name: string) => ({ id, name });

  it("прямое совпадение: бренд отбрасывается, остаток сравнивается по ключу", () => {
    expect(suggestTerminal("OYBEK", [T("t1", "Les Ailes Oybek")])).toBe("t1");
    expect(suggestTerminal("MEGA PLANET", [T("t1", "Les Ailes Megaplanet")])).toBe("t1");
    expect(suggestTerminal("C-1", [T("t1", "Les Ailes C1")])).toBe("t1");
  });

  it("бренд без учёта регистра и в обоих написаниях", () => {
    expect(suggestTerminal("OYBEK", [T("t1", "LES AILES Oybek")])).toBe("t1");
    expect(suggestTerminal("OYBEK", [T("t1", "les ailes oybek")])).toBe("t1");
    expect(suggestTerminal("OYBEK", [T("t1", "Chopar Pizza Oybek")])).toBe("t1");
    expect(suggestTerminal("OYBEK", [T("t1", "Chopar pizza Oybek")])).toBe("t1");
    expect(suggestTerminal("OYBEK", [T("t1", "CHOPAR PIZZA Oybek")])).toBe("t1");
  });

  it("терминал без бренда тоже сравнивается", () => {
    expect(suggestTerminal("OYBEK", [T("t1", "Oybek")])).toBe("t1");
  });

  it("бренд отбрасывается только в начале названия", () => {
    expect(suggestTerminal("OYBEK", [T("t1", "Oybek Les Ailes")])).toBeNull();
  });

  it("псевдоним M.GORKIY: Buyuk ipak yo'li", () => {
    expect(suggestTerminal("M.GORKIY", [T("t2", "Les Ailes Buyuk ipak yo'li")])).toBe("t2");
  });

  it("псевдоним C-5: Markaz-5", () => {
    expect(suggestTerminal("C-5", [T("t4", "Les Ailes Markaz-5")])).toBe("t4");
  });

  it("псевдоним RIVIERA: Rivyera", () => {
    expect(suggestTerminal("RIVIERA", [T("t5", "Les Ailes Rivyera")])).toBe("t5");
  });

  it("псевдоним QO'YLIQ: Qo‘yliq-5 с типографским апострофом", () => {
    expect(suggestTerminal("QO'YLIQ", [T("t3", "Chopar pizza Qo‘yliq-5")])).toBe("t3");
  });

  it("псевдонимы S.RAXIMOV и SOBIR RAHIMOV: S.Rahimov", () => {
    const terminals = [T("t6", "Les Ailes S.Rahimov")];
    expect(suggestTerminal("S.RAXIMOV", terminals)).toBe("t6");
    expect(suggestTerminal("SOBIR RAHIMOV", terminals)).toBe("t6");
    expect(suggestTerminal("S.RAHIMOV", terminals)).toBe("t6");
  });

  it("псевдоним применяется к ключу локации, а не к ключу терминала", () => {
    // Терминал с названием «Riviera» не получает подсказку: локация RIVIERA ищет RIVYERA.
    expect(suggestTerminal("RIVIERA", [T("t5", "Les Ailes Riviera")])).toBeNull();
  });

  it("нет совпадения: null", () => {
    expect(suggestTerminal("SERGELI", [T("t1", "Les Ailes Oybek"), T("t2", "Chopar pizza Golden life")])).toBeNull();
    expect(suggestTerminal("SERGELI", [])).toBeNull();
  });

  it("два совпадения: null", () => {
    expect(suggestTerminal("OYBEK", [T("t1", "Les Ailes Oybek"), T("t2", "Les Ailes OYBEK")])).toBeNull();
    expect(suggestTerminal("OYBEK", [T("t1", "Les Ailes Oybek"), T("t2", "Oybek")])).toBeNull();
  });

  it("одно совпадение среди нескольких терминалов", () => {
    const terminals = [T("t1", "Les Ailes Oybek"), T("t2", "Les Ailes Chilonzor"), T("t3", "Les Ailes Yunusobod")];
    expect(suggestTerminal("CHILONZOR", terminals)).toBe("t2");
  });

  it("пустой ключ локации и терминал из одного бренда не совпадают", () => {
    expect(suggestTerminal("", [T("t1", "Les Ailes")])).toBeNull();
    expect(suggestTerminal(" - ", [T("t1", "Les Ailes"), T("t2", "Chopar Pizza")])).toBeNull();
  });
});
