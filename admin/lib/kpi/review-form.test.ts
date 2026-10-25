import { describe, expect, it } from "bun:test";
import {
  SCORE_BUTTONS, changedItemIds, commentOk, draftFromItems, issueText, parseScoreInput, pickScore, previewPct,
  reviewIssues, reviewMode, scoreTextChange, toItemInputs, type FormItemLite,
} from "./review-form";

const items: FormItemLite[] = [
  { item_id: "m1", source: "manual", weight: 1, score: 100, note: null, suggestion: null },
  { item_id: "m2", source: "manual", weight: 1, score: 50, note: null, suggestion: null },
  { item_id: "a1", source: "attendance", weight: 1, score: null, note: null, suggestion: { score: 80, basis: "Workly: 20 из 25 дней вовремя" } },
];
// Отправленная оценка, где автопункт принял предложение
const sent: FormItemLite[] = items.map((i) => (i.item_id === "a1" ? { ...i, score: 80 } : i));
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
  it("draftFromItems: новая форма и черновик подставляют предложение в пустой автопункт", () => {
    for (const mode of ["new", "draft"] as const) expect(draftFromItems(items, mode).a1).toEqual({ score: 80, note: "" });
    for (const mode of ["readonly", "change"] as const) expect(draftFromItems(items, mode).a1).toEqual({ score: null, note: "" });
    // Сохранённый балл, «Нет данных» с заметкой, пункт без предложения и ручной пункт не трогаем
    const more: FormItemLite[] = [
      { ...items[2], score: 60, note: "болел" },
      { ...items[2], item_id: "a2", note: "терминал сломан" },
      { ...items[2], item_id: "a3", suggestion: null },
      { ...items[0], item_id: "m3", score: null, suggestion: { score: 90, basis: "—" } },
    ];
    expect(draftFromItems(more, "draft")).toEqual({
      a1: { score: 60, note: "болел" },
      a2: { score: null, note: "терминал сломан" },
      a3: { score: null, note: "" },
      m3: { score: null, note: "" },
    });
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
  it("отправка: пустой ручной пункт; автопункт без данных допустим, если предложения нет", () => {
    expect(reviewIssues(sent, { ...draftFromItems(sent), m2: { score: null, note: "" } }, "submit", "", 5)).toEqual([
      { code: "score_required", item_id: "m2" },
    ]);
    const bare = items.map((i) => ({ ...i, suggestion: null }));
    expect(reviewIssues(bare, draftFromItems(bare), "submit", "", 5)).toEqual([]);
  });
  it("«Нет данных» при предложении: черновик можно, отправка и изменение — только с заметкой", () => {
    const none = draftFromItems(items);
    expect(reviewIssues(items, none, "draft", "", 5)).toEqual([]);
    expect(reviewIssues(items, none, "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
    expect(reviewIssues(sent, { ...draftFromItems(sent), a1: { score: null, note: " " } }, "change", "нет данных Workly", 5)).toEqual([
      { code: "note_required", item_id: "a1" },
    ]);
    expect(reviewIssues(items, draft({ a1: { score: null, note: "Workly не работал" } }), "submit", "", 5)).toEqual([]);
    expect(issueText({ code: "note_required", item_id: "a1" }, 5)).toBe("Балл отличается от предложения или не поставлен — напишите заметку");
  });
  it("свой балл вместо предложения требует заметку", () => {
    expect(reviewIssues(items, draft({ a1: { score: 60 } }), "submit", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
    expect(reviewIssues(items, draft({ a1: { score: 60 } }), "draft", "", 5)).toEqual([{ code: "note_required", item_id: "a1" }]);
    expect(reviewIssues(items, draft({ a1: { score: 60, note: "болел" } }), "submit", "", 5)).toEqual([]);
    expect(reviewIssues(items, draft({ a1: { score: 80 } }), "submit", "", 5)).toEqual([]);
  });
  it("изменение отправленной", () => {
    const base = draftFromItems(sent);
    const changed = { ...base, m2: { score: 75, note: "" } };
    expect(reviewIssues(sent, changed, "change", "  ок  ", 5)).toEqual([{ code: "comment_required" }]);
    expect(reviewIssues(sent, changed, "change", "опоздал 3 раза", 5)).toEqual([]);
    expect(reviewIssues(sent, base, "change", "опоздал 3 раза", 5)).toEqual([{ code: "no_changes" }]);
    expect(reviewIssues(sent, { ...base, m1: { score: null, note: "" } }, "change", "опоздал 3 раза", 5)).toEqual([
      { code: "score_required", item_id: "m1" },
    ]);
  });
  it("changedItemIds смотрит только баллы", () => {
    expect(changedItemIds(items, draft({ m2: { score: 75 }, m1: { score: 100, note: "новая заметка" } }))).toEqual(["m2"]);
  });
});

describe("неверный текст балла", () => {
  it("scoreTextChange: «150» после «15» не отправит 15", () => {
    const v0 = { score: null, note: "" };
    const v1 = scoreTextChange(v0, "1")!;
    const v2 = scoreTextChange(v1, "15")!;
    const v3 = scoreTextChange(v2, "150")!;
    expect(v3).toEqual({ score: 15, note: "", invalid: true, text: "150" });
    // Тот же неверный текст — менять нечего; другой неверный — запоминаем, балл прежний.
    expect(scoreTextChange(v3, "150")).toBeNull();
    expect(scoreTextChange(v3, "1500")).toEqual({ score: 15, note: "", invalid: true, text: "1500" });
    // Стёрли «0»: балл прежний, флаг и текст снимаются.
    const back = scoreTextChange(v3, "15")!;
    expect(back).toEqual({ score: 15, note: "", invalid: false });
    expect("text" in back).toBe(false);
    expect(scoreTextChange({ score: 7, note: "" }, "7.5")).toEqual({ score: 7, note: "", invalid: true, text: "7.5" });
    expect(scoreTextChange({ score: 50, note: "x" }, "50")).toBeNull();
    expect(scoreTextChange({ score: 50, note: "x" }, "")).toEqual({ score: null, note: "x", invalid: false });
  });
  it("pickScore снимает флаг и при том же балле", () => {
    const picked = pickScore({ score: 50, note: "x", invalid: true, text: "50x" }, 50);
    expect(picked).toEqual({ score: 50, note: "x", invalid: false });
    expect("text" in picked).toBe(false);
    expect(pickScore({ score: 50, note: "", invalid: true }, null)).toEqual({ score: null, note: "", invalid: false });
  });
  it("bad_score_text блокирует черновик, отправку и изменение", () => {
    const bad = { ...draftFromItems(sent), m2: { score: 15, note: "", invalid: true } };
    expect(reviewIssues(sent, bad, "draft", "", 5)).toEqual([{ code: "bad_score_text", item_id: "m2" }]);
    expect(reviewIssues(sent, bad, "submit", "", 5)).toEqual([{ code: "bad_score_text", item_id: "m2" }]);
    expect(reviewIssues(sent, bad, "change", "опоздал 3 раза", 5)).toEqual([{ code: "bad_score_text", item_id: "m2" }]);
  });
  it("одна проблема на пункт: неверный текст важнее пустого балла и заметки", () => {
    const bad = { ...draftFromItems(items), m1: { score: null, note: "", invalid: true }, a1: { score: 60, note: "", invalid: true } };
    expect(reviewIssues(items, bad, "submit", "", 5)).toEqual([
      { code: "bad_score_text", item_id: "m1" },
      { code: "bad_score_text", item_id: "a1" },
    ]);
  });
  it("invalid: false — обычные правила", () => {
    expect(reviewIssues(sent, { ...draftFromItems(sent), m2: { score: 50, note: "", invalid: false } }, "submit", "", 5)).toEqual([]);
  });
  it("issueText", () => expect(issueText({ code: "bad_score_text", item_id: "m2" }, 5)).toBe("Целое от 0 до 100"));
});
