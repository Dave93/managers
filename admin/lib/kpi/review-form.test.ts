import { describe, expect, it } from "bun:test";
import {
  SCORE_BUTTONS, changedItemIds, commentOk, draftFromItems, issueText, parseScoreInput, previewPct,
  reviewIssues, reviewMode, toItemInputs, type FormItemLite,
} from "./review-form";

const items: FormItemLite[] = [
  { item_id: "m1", source: "manual", weight: 1, score: 100, note: null, suggestion: null },
  { item_id: "m2", source: "manual", weight: 1, score: 50, note: null, suggestion: null },
  { item_id: "a1", source: "attendance", weight: 1, score: null, note: null, suggestion: { score: 80, basis: "Workly: 20 из 25 дней вовремя" } },
];
const draft = (over: Record<string, { score: number | null; note?: string }>) => {
  const d = draftFromItems(items);
  for (const [k, v] of Object.entries(over)) d[k] = { score: v.score, note: v.note ?? "" };
  return d;
};

describe("баллы", () => {
  it("кнопки", () => expect([...SCORE_BUTTONS]).toEqual([0, 25, 50, 75, 100]));
  it("пустое поле — нет оценки, не ноль", () => {
    expect(parseScoreInput("")).toBeNull();
    expect(parseScoreInput("   ")).toBeNull();
    expect(parseScoreInput("0")).toBe(0);
    expect(parseScoreInput(" 75 ")).toBe(75);
    for (const bad of ["50.5", "50,5", "101", "-1", "abc", "1e2"]) expect(parseScoreInput(bad)).toBe("invalid");
  });
  it("draftFromItems берёт сохранённое", () => {
    expect(draftFromItems(items)).toEqual({ m1: { score: 100, note: "" }, m2: { score: 50, note: "" }, a1: { score: null, note: "" } });
  });
  it("toItemInputs: порядок формы, пустая заметка — null", () => {
    expect(toItemInputs(items, draft({ a1: { score: 60, note: "  болел  " }, m2: { score: 50, note: "   " } }))).toEqual([
      { item_id: "m1", score: 100, note: null },
      { item_id: "m2", score: 50, note: null },
      { item_id: "a1", score: 60, note: "болел" },
    ]);
  });
  it("previewPct как scorePct на сервере", () => {
    expect(previewPct(items, draftFromItems(items))).toBe(75);
    expect(previewPct(items, draft({ m1: { score: null }, m2: { score: null } }))).toBeNull();
    expect(previewPct([{ ...items[0], weight: 2 }, items[1]], { m1: { score: 100, note: "" }, m2: { score: 70, note: "" } })).toBe(90);
    expect(previewPct([items[0], { ...items[1], weight: 2 }], { m1: { score: 100, note: "" }, m2: { score: 0, note: "" } })).toBe(33.33);
  });
});

describe("комментарий и режимы", () => {
  it("commentOk: векторы плана 1", () => {
    expect(commentOk("   \n  ", 5)).toBe(false);
    expect(commentOk("ок да", 5)).toBe(false);
    expect(commentOk("опоздал 3 раза", 5)).toBe(true);
    // R1: считаются только буквы и цифры, как на сервере
    expect(commentOk(".....", 5)).toBe(false);
    expect(commentOk("а.б.в.г.д", 5)).toBe(true);
  });
  it("reviewMode", () => {
    expect(reviewMode(false, "submitted")).toBe("readonly");
    expect(reviewMode(true, null)).toBe("new");
    expect(reviewMode(true, "draft")).toBe("draft");
    expect(reviewMode(true, "submitted")).toBe("change");
  });
  it("issueText", () => expect(issueText({ code: "comment_required" }, 5)).toBe("Комментарий к изменению — не меньше 5 символов без пробелов"));
});

describe("reviewIssues", () => {
  it("черновик можно сохранить неполным", () => {
    expect(reviewIssues(items, draft({ m2: { score: null } }), "draft", "", 5)).toEqual([]);
  });
  it("отправка: пустой ручной пункт, автопункт без данных допустим", () => {
    expect(reviewIssues(items, draft({ m2: { score: null } }), "submit", "", 5)).toEqual([{ code: "score_required", item_id: "m2" }]);
    expect(reviewIssues(items, draftFromItems(items), "submit", "", 5)).toEqual([]);
  });
  it("свой балл вместо предложения требует заметку", () => {
    expect(reviewIssues(items, draft({ a1: { score: 60 } }), "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
    expect(reviewIssues(items, draft({ a1: { score: 60 } }), "draft", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
    expect(reviewIssues(items, draft({ a1: { score: 60, note: "болел" } }), "submit", "", 5)).toEqual([]);
    expect(reviewIssues(items, draft({ a1: { score: 80 } }), "submit", "", 5)).toEqual([]);
  });
  it("изменение отправленной", () => {
    const changed = draft({ m2: { score: 75 } });
    expect(reviewIssues(items, changed, "change", "  ок  ", 5)).toEqual([{ code: "comment_required" }]);
    expect(reviewIssues(items, changed, "change", "опоздал 3 раза", 5)).toEqual([]);
    expect(reviewIssues(items, draftFromItems(items), "change", "опоздал 3 раза", 5)).toEqual([{ code: "no_changes" }]);
    expect(reviewIssues(items, draft({ m1: { score: null } }), "change", "опоздал 3 раза", 5)).toEqual([{ code: "score_required", item_id: "m1" }]);
  });
  it("changedItemIds смотрит только баллы", () => {
    expect(changedItemIds(items, draft({ m2: { score: 75 }, m1: { score: 100, note: "новая заметка" } }))).toEqual(["m2"]);
  });
});
