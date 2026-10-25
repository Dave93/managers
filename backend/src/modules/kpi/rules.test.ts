import { describe, expect, it } from "bun:test";
import * as R from "./rules";

const tiers = [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }];
const it_ = (id: string, score: number | null, weight = 1, source: R.ItemSource = "manual") => ({ item_id: id, score, weight, source });

describe("scorePct", () => {
  it("пустые пункты выпадают, веса пересчитываются", () => {
    expect(R.scorePct([it_("a", 90), it_("b", 80), it_("c", null, 1, "attendance")])).toBe(85);
    expect(R.scorePct([it_("a", 100, 2), it_("b", 70, 1)])).toBe(90);
    expect(R.scorePct([it_("a", 100, 1), it_("b", 0, 2)])).toBe(33.33);
    expect(R.scorePct([it_("a", null)])).toBeNull();
  });
  it("missingManual видит только ручные", () => {
    expect(R.missingManual([it_("a", null), it_("b", null, 1, "attendance"), it_("c", 50)])).toEqual(["a"]);
  });
});

describe("ввод", () => {
  it("isScore", () => {
    for (const ok of [0, 50, 100]) expect(R.isScore(ok)).toBe(true);
    for (const bad of [-1, 101, 50.5, "50", null]) expect(R.isScore(bad)).toBe(false);
  });
  it("commentOk", () => {
    expect(R.commentOk("   \n  ", 5)).toBe(false);
    expect(R.commentOk("ок да", 5)).toBe(false);
    expect(R.commentOk("опоздал 3 раза", 5)).toBe(true);
    expect(R.commentOk(undefined, 1)).toBe(false);
    // Считаются только буквы и цифры.
    expect(R.commentOk(".....", 3)).toBe(false);
    expect(R.commentOk("!?-—…", 1)).toBe(false);
    expect(R.commentOk("​​​​​", 3)).toBe(false); // zero-width space
    expect(R.commentOk(" ⁠﻿‍", 1)).toBe(false);
    expect(R.commentOk("а.б.в", 3)).toBe(true);
    expect(R.commentOk("toʻgʻri", 7)).toBe(true); // ʻ (U+02BB) в узбекской латинице — буква
    expect(R.commentOk("1 2", 2)).toBe(true);
  });
  it("violationHint", () => {
    expect(R.violationHint(0, 10)).toBe(100);
    expect(R.violationHint(3, 10)).toBe(70);
    expect(R.violationHint(12, 10)).toBe(0);
  });
});

describe("effectiveCardId", () => {
  const cards: R.CardLite[] = [
    { id: "cook", staff_role_codes: ["cook", "universal_cook"], active: true, sort: 10 },
    { id: "old", staff_role_codes: ["cook"], active: false, sort: 1 },
    { id: "cleaner", staff_role_codes: [], active: true, sort: 60 },
  ];
  it("по роли, неактивная пропускается", () => {
    expect(R.effectiveCardId({ staff_role_code: "universal_cook", is_trainee: false }, undefined, cards)).toEqual({ card_id: "cook", source: "role" });
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: false }, undefined, cards)).toEqual({ card_id: "cook", source: "role" });
  });
  it("ручное назначение побеждает, null = не оценивается", () => {
    expect(R.effectiveCardId({ staff_role_code: "hall_worker", is_trainee: false }, { card_id: "cleaner" }, cards)).toEqual({ card_id: "cleaner", source: "override" });
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: false }, { card_id: null }, cards)).toEqual({ card_id: null, source: "override" });
  });
  it("стажёр и роль без карты", () => {
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: true }, undefined, cards)).toEqual({ card_id: null, source: null });
    expect(R.effectiveCardId({ staff_role_code: null, is_trainee: null }, undefined, cards)).toEqual({ card_id: null, source: null });
  });
  it("при нескольких картах побеждает меньший sort", () => {
    const two: R.CardLite[] = [
      { id: "b", staff_role_codes: ["cook"], active: true, sort: 20 },
      { id: "a", staff_role_codes: ["cook"], active: true, sort: 5 },
    ];
    expect(R.effectiveCardId({ staff_role_code: "cook", is_trainee: false }, undefined, two)).toEqual({ card_id: "a", source: "role" });
  });
});

describe("scopeCovers", () => {
  it("null — любой", () => {
    expect(R.scopeCovers([{ card_id: null, terminal_id: "t1" }], { card_id: "cook", terminal_id: "t1" })).toBe(true);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: "cook", terminal_id: "t9" })).toBe(true);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: "cashier", terminal_id: "t9" })).toBe(false);
    expect(R.scopeCovers([{ card_id: "cook", terminal_id: null }], { card_id: null, terminal_id: "t9" })).toBe(false);
    expect(R.scopeCovers([{ card_id: null, terminal_id: null }], { card_id: null, terminal_id: "t9" })).toBe(true);
    expect(R.scopeCovers([], { card_id: "cook", terminal_id: "t1" })).toBe(false);
  });
});

describe("повышение", () => {
  it("ступени", () => {
    expect(R.raiseFor(84.99, tiers)).toBe(0);
    expect(R.raiseFor(85, tiers)).toBe(150000);
    expect(R.raiseFor(94.99, tiers)).toBe(300000);
    expect(R.raiseFor(100, tiers)).toBe(500000);
  });
  it("пример из плана: 92, 96, 94 → 94% и 300 000", () => {
    expect(R.quarterRow([92, 96, 94], tiers, 2)).toEqual({ months_scored: 3, avg_pct: 94, status: "proposed", suggested_amount: 300000 });
  });
  it("мало месяцев", () => {
    expect(R.quarterRow([95, null, null], tiers, 2)).toEqual({ months_scored: 1, avg_pct: 95, status: "insufficient", suggested_amount: 0 });
    expect(R.quarterRow([95, 95, null], tiers, 2)).toEqual({ months_scored: 2, avg_pct: 95, status: "proposed", suggested_amount: 500000 });
    expect(R.quarterRow([null, null, null], tiers, 2)).toEqual({ months_scored: 0, avg_pct: null, status: "insufficient", suggested_amount: 0 });
  });
  it("validateTiers", () => {
    expect(R.validateTiers(tiers, 500000)).toBeNull();
    expect(R.validateTiers([{ min_pct: 95, amount: 600000 }], 500000)).toBe("tier_amount_over_cap");
    expect(R.validateTiers([{ min_pct: 101, amount: 1 }], 500000)).toBe("tier_pct_range");
    expect(R.validateTiers([{ min_pct: 90, amount: 1 }, { min_pct: 90, amount: 2 }], 500000)).toBe("tier_pct_duplicate");
    expect(R.validateTiers([], 500000)).toBeNull();
  });
});

describe("diffScores", () => {
  it("только изменённые", () => {
    expect(R.diffScores({ a: 50, b: 80, c: null }, { a: 50, b: 90, c: 10 })).toEqual([
      { item_id: "b", old: 80, new: 90 },
      { item_id: "c", old: null, new: 10 },
    ]);
  });
});

describe("настройки", () => {
  it("дефолты", () => {
    expect(R.DEFAULT_SETTINGS).toEqual({ review_deadline_day: 7, dispute_deadline_day: 10, reminder_days_before: 7, raise_cap: 500000, raise_min_months: 2, violation_photo_required: false, violation_penalty_hint: 10, change_comment_min: 5 });
  });
  it("validateSettingsPatch", () => {
    expect(R.validateSettingsPatch({ review_deadline_day: 5 })).toBeNull();
    expect(R.validateSettingsPatch({ foo: 1 })).toBe("unknown_setting");
    expect(R.validateSettingsPatch({ review_deadline_day: 29 })).toBe("bad_day");
    expect(R.validateSettingsPatch({ raise_min_months: 4 })).toBe("bad_value");
    expect(R.validateSettingsPatch({ violation_photo_required: "yes" })).toBe("bad_value");
    expect(R.validateSettingsPatch({ review_deadline_day: 12, dispute_deadline_day: 10 })).toBe("dispute_before_review");
  });
});

describe("noDataNoteRequired", () => {
  const S = { score: 80 };
  it("автопункт с предложением и «нет данных» без заметки — нужна", () => {
    expect(R.noDataNoteRequired("attendance", S, null, null)).toBe(true);
    expect(R.noDataNoteRequired("attendance", S, null, "  ")).toBe(true);
    expect(R.noDataNoteRequired("cooking_speed", S, null, undefined)).toBe(true);
  });
  it("с заметкой, с баллом, без предложения, ручной пункт — не нужна", () => {
    expect(R.noDataNoteRequired("attendance", S, null, "сбой терминала")).toBe(false);
    expect(R.noDataNoteRequired("attendance", S, 80, null)).toBe(false);
    expect(R.noDataNoteRequired("attendance", S, 40, null)).toBe(false);
    expect(R.noDataNoteRequired("attendance", null, null, null)).toBe(false);
    expect(R.noDataNoteRequired("manual", S, null, null)).toBe(false);
  });
});

describe("noteRequired", () => {
  it("без предложения заметка не нужна", () => {
    expect(R.noteRequired(null, 40, null)).toBe(false);
  });
  it("балл как у предложения или пустой — заметка не нужна", () => {
    expect(R.noteRequired({ score: 80 }, 80, null)).toBe(false);
    expect(R.noteRequired({ score: 80 }, null, null)).toBe(false);
  });
  it("другой балл без заметки — нужна; с заметкой, но из пробелов — тоже", () => {
    expect(R.noteRequired({ score: 80 }, 60, undefined)).toBe(true);
    expect(R.noteRequired({ score: 80 }, 60, "   ")).toBe(true);
    expect(R.noteRequired({ score: 80 }, 60, "причина")).toBe(false);
  });
});
