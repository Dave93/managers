import { expect, it } from "bun:test";
import type { TgRaiseHint } from "@backend/modules/kpi/tg-app/types";
import { hintLines, raiseBadge } from "../src/hint";

const nb = "\u00a0";

const EX1: TgRaiseHint = { kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-10-01"], amount: 300000,
  next: { amount: 500000, reachable: true, need_pct: 97.4, periods: ["2026-11-01", "2026-12-01"] } };
const EX2: TgRaiseHint = { kind: "running", amount: 300000, keep: { need_pct: 86.7, periods: ["2026-12-01"] }, next: { amount: 500000, reachable: false } };

it("макет 1 и макет 2 по-русски", () => {
  expect(hintLines(EX1, "ru")).toEqual(["Оценён 1 месяц из 3, а прибавку считают от 2.",
    `Держите уровень октября — выйдет 300${nb}000${nb}сум.`, `Для 500${nb}000${nb}сум — в среднем 97,4${nb}% за ноябрь и декабрь.`]);
  expect(hintLines(EX2, "ru")).toEqual([`Сейчас выходит 300${nb}000${nb}сум.`, `Сохранится, если в декабре будет от 86,7${nb}%.`,
    `500${nb}000${nb}сум в этом квартале уже не получится.`]);
});
it("макеты по-узбекски", () => {
  expect(hintLines(EX1, "uz")).toEqual(["3 oydan 1 tasi baholangan, oshirish esa kamida 2 oy boʻyicha hisoblanadi.",
    `Oktabr darajasini saqlang — 300${nb}000${nb}soʻm chiqadi.`, `500${nb}000${nb}soʻm uchun noyabr va dekabr boʻyicha oʻrtacha 97,4${nb}% kerak.`]);
  expect(hintLines(EX2, "uz")).toEqual([`Hozir 300${nb}000${nb}soʻm chiqmoqda.`, `Dekabr boʻyicha kamida 86,7${nb}% boʻlsa, saqlanadi.`,
    `Bu chorakda 500${nb}000${nb}soʻm endi chiqmaydi.`]);
});
it("прочие ветки", () => {
  expect(hintLines({ kind: "none" }, "ru")).toEqual(["Оценок в этом квартале ещё нет."]);
  expect(hintLines({ kind: "too_few", scored: 2, min_months: 3, keep_periods: ["2026-10-01", "2026-11-01"], amount: 0, next: null }, "ru"))
    .toEqual(["Оценено 2 месяца из 3, а прибавку считают от 3.", "При таком уровне прибавки не будет."]);
  expect(hintLines({ kind: "running", amount: 0, keep: null, next: null }, "uz")).toEqual(["Hozircha oshirishsiz."]);
  expect(hintLines({ kind: "waiting_hr", amount: 0 }, "ru")).toEqual(["Ждём решения HR. Предварительно: без прибавки."]);
  expect(hintLines({ kind: "waiting_hr", amount: 150000 }, "uz")).toEqual([`HR qarorini kutyapmiz. Taxminan: 150${nb}000${nb}soʻm.`]);
  expect(hintLines({ kind: "decided", amount: 500000 }, "ru")).toEqual([]);
  // impossible: одна строка, ни суммы, ни «для X», ни «сохранится»; плашка приглушённая, не «предварительно»
  expect(hintLines({ kind: "impossible", scored: 1, min_months: 3 }, "ru")).toEqual(["В этом квартале прибавки не будет: оценено 1 мес., а нужно не меньше 3."]);
  expect(hintLines({ kind: "impossible", scored: 0, min_months: 2 }, "uz")).toEqual(["Bu chorakda oshirish boʻlmaydi: 0 oy baholangan, kerak esa kamida 2 oy."]);
  expect([raiseBadge({ kind: "impossible", scored: 1, min_months: 2 }, "ru"), raiseBadge({ kind: "impossible", scored: 1, min_months: 2 }, "uz")])
    .toEqual([{ text: "Без прибавки", tone: "muted" }, { text: "Oshirishsiz", tone: "muted" }]);
  expect([raiseBadge({ kind: "decided", amount: 500000 }, "ru"), raiseBadge({ kind: "decided", amount: 0 }, "uz"), raiseBadge(EX1, "ru")])
    .toEqual([{ text: `Утверждено: +500${nb}000${nb}сум`, tone: "ok" }, { text: "Oshirishsiz", tone: "muted" }, { text: "предварительно", tone: "prelim" }]);
});
it("язык подсказки не зависит от глобального lang()", () => {
  // hintLines принимает язык явно: глобальный по умолчанию ru, а строки узбекские
  expect(hintLines({ kind: "none" }, "uz")).toEqual(["Bu chorakda hali baho yoʻq."]);
});

// Сервер новее клиента прислал вид подсказки, которого клиент не знает: карточка прибавки не
// падает — без строк подсказки и с плашкой «предварительно».
it("незнакомый вид подсказки — пусто и «предварительно», без исключения", () => {
  const future = { kind: "future_kind", amount: 1 } as unknown as TgRaiseHint;
  expect(hintLines(future, "ru")).toEqual([]);
  expect(hintLines(future, "uz")).toEqual([]);
  expect(raiseBadge(future, "ru")).toEqual({ text: "предварительно", tone: "prelim" });
  expect(raiseBadge(future, "uz")).toEqual({ text: raiseBadge({ kind: "none" }, "uz").text, tone: "prelim" });
});
