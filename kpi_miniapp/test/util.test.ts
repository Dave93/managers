import { expect, it } from "bun:test";
import { capFirst, latch, noWidow, reasonCount } from "../src/util";

it("latch: take один раз, release возвращает", () => {
  const l = latch();
  expect([l.take(), l.take()]).toEqual([true, false]);
  l.release();
  expect(l.take()).toBe(true);
});
it("capFirst и reasonCount", () => {
  expect([capFirst("noyabrdagi"), capFirst("")]).toEqual(["Noyabrdagi", ""]);
  expect([reasonCount("  ок!! "), reasonCount("18 окт"), reasonCount("")]).toEqual([2, 5, 0]);
});

// Последнее слово не остаётся одно на строке, и когда оно само склеено неразрывным пробелом
// («95,0 %.», «500 000 сум.»): в JS \S не берёт U+00A0, и прежнее правило такие концы пропускало.
it("noWidow: склеивает последнее слово с предыдущим, в том числе слово с U+00A0 внутри", () => {
  const nb = "\u00a0";
  expect(noWidow("Ответ придёт в бот.")).toBe(`Ответ придёт в${nb}бот.`);
  expect(noWidow(`Сохранится, если в декабре будет от 95,0${nb}%.`)).toBe(`Сохранится, если в декабре будет от${nb}95,0${nb}%.`);
  expect(noWidow(`Сейчас выходит 500${nb}000${nb}сум.`)).toBe(`Сейчас выходит${nb}500${nb}000${nb}сум.`);
  expect([noWidow("одно"), noWidow(""), noWidow(`уже${nb}склеено`)]).toEqual(["одно", "", `уже${nb}склеено`]);
});
