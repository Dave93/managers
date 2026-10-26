import { expect, it } from "bun:test";
import { ddmm, dayMonth, hhmm, initials, pct1, sum, sumShort, trackPos } from "../src/format";

const nb = "\u00a0";

it("pct1 и защита порога", () => {
  expect([pct1(91.65), pct1(90.3), pct1(93), pct1(100), pct1(89.96)]).toEqual(["91,7", "90,3", "93,0", "100,0", "90,0"]);
  expect([pct1(89.96, [85, 90, 95]), pct1(94.96, [85, 90, 95]), pct1(90, [85, 90, 95]), pct1(91.65, [85, 90, 95])]).toEqual(["89,9", "94,9", "90,0", "91,7"]);
});
it("суммы, даты по Ташкенту, инициалы, шкала", () => {
  expect([sum(300000), sum(0), sum(1500000)]).toEqual([`300${nb}000`, "0", `1${nb}500${nb}000`]);
  expect([sumShort(150000, "ru"), sumShort(150500, "ru"), sumShort(1500000, "uz"), sumShort(900, "ru")]).toEqual([`150${nb}тыс`, `150,5${nb}тыс`, `1,5${nb}mln`, "900"]);
  expect([dayMonth("2026-11-10T18:59:59.999Z", "ru"), dayMonth("2026-11-10T18:59:59.999Z", "uz"), dayMonth("2026-11-19T19:00:00.000Z", "ru")])
    .toEqual(["10 ноября", "10-noyabr", "20 ноября"]);
  expect([ddmm("2026-12-19T19:00:00.000Z"), hhmm(Date.UTC(2026, 9, 26, 9, 2))]).toEqual(["20.12", "14:02"]);
  expect(initials("Тест", "Повар")).toBe("ТП");
  expect(trackPos(90.3, [85, 90, 95])).toBeCloseTo(0.515, 6);
  expect([trackPos(80, [85, 90, 95]), trackPos(100, [85, 90, 95]), trackPos(60, [85, 90, 95])]).toEqual([0.125, 1, 0]);
});
it("sumShort: миллионы и ming/млн, шкала без ступеней", () => {
  expect([sumShort(2000000, "ru"), sumShort(150000, "uz"), sumShort(1000, "ru")]).toEqual([`2${nb}млн`, `150${nb}ming`, `1${nb}тыс`]);
  expect(trackPos(50, [])).toBe(0);
});
