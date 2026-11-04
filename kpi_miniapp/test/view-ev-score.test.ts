import { expect, it } from "bun:test";
import { SCORE_BUTTONS, type DraftItem, type FormItemLite, changedItemIds, draftFromItems, evIssueText, parseScoreInput, previewPct, reviewIssues, scoreTextChange, toItemInputs } from "../src/view/ev-score";

const items: FormItemLite[] = [
  { item_id: "m1", source: "manual", weight: 1, score: 100, note: null, suggestion: null },
  { item_id: "m2", source: "manual", weight: 1, score: 50, note: null, suggestion: null },
  { item_id: "a1", source: "attendance", weight: 1, score: null, note: null, suggestion: { score: 80, basis: "Workly: 20 из 25 дней вовремя" } },
];
const sent: FormItemLite[] = items.map((i) => (i.item_id === "a1" ? { ...i, score: 80 } : i));

it("кнопки и разбор поля балла", () => {
  expect([...SCORE_BUTTONS]).toEqual([0, 25, 50, 75, 100]);
  expect([parseScoreInput(""), parseScoreInput("   "), parseScoreInput("0"), parseScoreInput(" 75 ")]).toEqual([null, null, 0, 75]);
  for (const bad of ["50.5", "50,5", "101", "-1", "abc", "1e2"]) expect(parseScoreInput(bad)).toBe("invalid");
  const v: DraftItem = { score: 50, note: "" };
  expect(scoreTextChange(v, "150")).toEqual({ score: 50, note: "", invalid: true, text: "150" });
  expect(scoreTextChange({ ...v, invalid: true, text: "150" }, "150")).toBeNull();
  expect(scoreTextChange({ ...v, invalid: true, text: "150" }, "75")).toEqual({ score: 75, note: "", invalid: false });
});
it("черновик из формы: предложение подставляется в пустой автопункт только при prefill", () => {
  expect(draftFromItems(items, false)).toEqual({ m1: { score: 100, note: "" }, m2: { score: 50, note: "" }, a1: { score: null, note: "" } });
  expect(draftFromItems(items, true).a1).toEqual({ score: 80, note: "" });
  const noted: FormItemLite[] = [{ ...items[2]!, note: "терминал сломан" }];
  expect(draftFromItems(noted, true).a1).toEqual({ score: null, note: "терминал сломан" });
});
it("toItemInputs и previewPct", () => {
  const d = draftFromItems(items, true);
  d.a1 = { score: 60, note: "  болел  " }; d.m2 = { score: 50, note: "   " };
  expect(toItemInputs(items, d)).toEqual([{ item_id: "m1", score: 100, note: null }, { item_id: "m2", score: 50, note: null }, { item_id: "a1", score: 60, note: "болел" }]);
  expect(previewPct(items, draftFromItems(items, false))).toBe(75);
  expect(previewPct(items, { m1: { score: null, note: "" }, m2: { score: null, note: "" }, a1: { score: null, note: "" } })).toBeNull();
  expect(previewPct([items[0]!, { ...items[1]!, weight: 2 }], { m1: { score: 100, note: "" }, m2: { score: 0, note: "" } })).toBe(33.33);
});
it("reviewIssues: черновик неполным, отправка требует баллы и заметки, изменение — комментарий и разницу", () => {
  const d0 = draftFromItems(items, true);
  expect(reviewIssues(items, { ...d0, m2: { score: null, note: "" } }, "draft", "", 5)).toEqual([]);
  expect(reviewIssues(items, { ...d0, m2: { score: null, note: "" } }, "submit", "", 5)).toEqual([{ code: "score_required", item_id: "m2" }]);
  expect(reviewIssues(items, draftFromItems(items, false), "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
  expect(reviewIssues(items, { ...d0, a1: { score: 60, note: "" } }, "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
  expect(reviewIssues(items, { ...d0, a1: { score: 60, note: "болел" } }, "submit", "", 5)).toEqual([]);
  expect(reviewIssues(items, { ...d0, m1: { score: 100, note: "", invalid: true, text: "150" } }, "draft", "", 5)).toEqual([{ code: "bad_score_text", item_id: "m1" }]);
  const base = draftFromItems(sent, false);
  expect(reviewIssues(sent, { ...base, m2: { score: 75, note: "" } }, "change", "  ок  ", 5)).toEqual([{ code: "comment_required" }]);
  expect(reviewIssues(sent, base, "change", "опоздал 3 раза", 5)).toEqual([{ code: "no_changes" }]);
  expect(changedItemIds(items, { ...draftFromItems(items, false), m2: { score: 75, note: "" }, m1: { score: 100, note: "новая заметка" } })).toEqual(["m2"]);
});
it("evIssueText на двух языках", () => {
  expect(evIssueText({ code: "comment_required" }, 5, "ru")).toBe("Комментарий — не меньше 5 букв или цифр");
  expect(evIssueText({ code: "note_required", item_id: "a1" }, 5, "ru")).toBe("Балл отличается от предложения или не поставлен: напишите заметку");
  expect(evIssueText({ code: "no_changes" }, 5, "uz").length).toBeGreaterThan(0);
});
