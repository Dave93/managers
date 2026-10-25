import { describe, expect, it } from "bun:test";
import type { KpiSettings } from "@admin/lib/kpi-api";
import {
  ITEM_SOURCE_OPTIONS,
  SETTINGS_FIELDS,
  assignBody,
  assignValue,
  cardAssignLabel,
  cardCodeOk,
  externalIdIssue,
  externalIdValue,
  parseRoleCodes,
  scopeLabel,
  settingsIssues,
  settingsPatch,
  tiersFromDraft,
} from "./settings";

describe("карты", () => {
  it("parseRoleCodes", () => {
    expect(parseRoleCodes("cook, universal_cook\nCOOK  ")).toEqual(["cook", "universal_cook"]);
    expect(parseRoleCodes(" , ")).toEqual([]);
  });
  it("cardCodeOk", () => {
    for (const ok of ["cook", "cashier_plus", "c2"]) expect(cardCodeOk(ok)).toBe(true);
    for (const bad of ["", "c", "Cook", "2cook", "повар", "a".repeat(41)]) expect(cardCodeOk(bad)).toBe(false);
  });
  it("источники: данные подтягиваются у всех пяти", () => {
    expect(ITEM_SOURCE_OPTIONS.map((o) => [o.value, o.ready])).toEqual([
      ["manual", true], ["attendance", true], ["cooking_speed", true], ["sales_plan", true], ["food_cost", true],
    ]);
  });
});

describe("табельный номер", () => {
  it("значение и проверка", () => {
    expect(externalIdValue("  T-1 ")).toBe("T-1");
    expect(externalIdValue("   ")).toBeNull();
    expect(externalIdIssue("a".repeat(100))).toBeNull();
    expect(externalIdIssue(` ${"a".repeat(100)} `)).toBeNull();
    expect(externalIdIssue("a".repeat(101))).toBe("Табельный номер — не длиннее 100 символов");
  });
});

describe("карта сотрудника", () => {
  const card = { id: "c-cl", code: "cleaner", title_ru: "Техничка" };
  it("assignValue и assignBody", () => {
    expect(assignValue({ card, card_source: "override" })).toBe("c-cl");
    expect(assignValue({ card: null, card_source: "override" })).toBe("none");
    expect(assignValue({ card, card_source: "role" })).toBe("auto");
    expect(assignValue({ card: null, card_source: null })).toBe("auto");
    expect(assignBody("auto")).toBe("auto");
    expect(assignBody("none")).toBeNull();
    expect(assignBody("c-cl")).toBe("c-cl");
  });
  it("cardAssignLabel", () => {
    expect(cardAssignLabel({ card, card_source: "override" })).toBe("Вручную: Техничка");
    expect(cardAssignLabel({ card: null, card_source: "override" })).toBe("Не оценивается");
    expect(cardAssignLabel({ card: { ...card, title_ru: "Повар" }, card_source: "role" })).toBe("По должности: Повар");
    expect(cardAssignLabel({ card: null, card_source: null })).toBe("Нет карты");
  });
});

const DEFAULTS: KpiSettings = {
  review_deadline_day: 7, dispute_deadline_day: 10, reminder_days_before: 7, raise_cap: 500000,
  raise_min_months: 2, violation_photo_required: false, violation_penalty_hint: 10, change_comment_min: 5,
};

describe("шкала", () => {
  it("tiersFromDraft", () => {
    expect(tiersFromDraft([{ min_pct: "85", amount: "150 000" }, { min_pct: "95", amount: "500000" }, { min_pct: "90", amount: "300000" }], 500000))
      .toEqual({ tiers: [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }] });
    expect(tiersFromDraft([{ min_pct: "92,5", amount: "1" }], 500000)).toEqual({ tiers: [{ min_pct: 92.5, amount: 1 }] });
    expect(tiersFromDraft([], 500000)).toEqual({ tiers: [] });
    expect(tiersFromDraft([{ min_pct: "101", amount: "1" }], 500000)).toEqual({ error: "Порог ступени — число от 0 до 100" });
    expect(tiersFromDraft([{ min_pct: "90", amount: "-1" }], 500000)).toEqual({ error: "Сумма ступени — целое число сум, не меньше 0" });
    expect(tiersFromDraft([{ min_pct: "95", amount: "600000" }], 500000)).toEqual({ error: "Сумма ступени больше потолка повышения (500\u00a0000\u00a0сум)" });
    expect(tiersFromDraft([{ min_pct: "90", amount: "1" }, { min_pct: "90,00", amount: "2" }], 500000)).toEqual({ error: "Пороги ступеней не должны повторяться" });
  });
});

describe("сроки", () => {
  it("SETTINGS_FIELDS — ровно ключи настроек с диапазонами плана 1", () => {
    expect(SETTINGS_FIELDS.map((f) => [f.key, f.kind, f.min ?? null, f.max ?? null])).toEqual([
      ["review_deadline_day", "int", 1, 28], ["dispute_deadline_day", "int", 1, 28], ["reminder_days_before", "int", 0, 27],
      ["raise_cap", "int", 0, 10000000], ["raise_min_months", "int", 1, 3], ["violation_photo_required", "bool", null, null],
      ["violation_penalty_hint", "int", 0, 100], ["change_comment_min", "int", 1, 200],
    ]);
    expect(SETTINGS_FIELDS.map((f) => f.key).sort()).toEqual((Object.keys(DEFAULTS) as (keyof KpiSettings)[]).sort());
  });
  it("settingsIssues", () => {
    expect(settingsIssues(DEFAULTS)).toEqual([]);
    expect(settingsIssues({ ...DEFAULTS, review_deadline_day: 29 })).toEqual(["Срок оценок, число следующего месяца: от 1 до 28"]);
    expect(settingsIssues({ ...DEFAULTS, review_deadline_day: 12 })).toEqual(["Срок споров не может быть раньше срока оценок"]);
    expect(settingsIssues({ ...DEFAULTS, raise_min_months: 1.5 })).toEqual(["Минимум оценённых месяцев в квартале: от 1 до 3"]);
  });
  it("settingsIssues: стёртое поле (NaN) — ошибка", () => {
    expect(settingsIssues({ ...DEFAULTS, reminder_days_before: NaN })).toEqual(["Напоминать оценщикам за, дней: от 0 до 27"]);
  });
  it("settingsPatch: переключённый bool попадает в патч", () => {
    expect(settingsPatch(DEFAULTS, { ...DEFAULTS, violation_photo_required: true })).toEqual({ violation_photo_required: true });
  });
  it("settingsPatch — только изменённое", () => {
    expect(settingsPatch(DEFAULTS, { ...DEFAULTS, change_comment_min: 10 })).toEqual({ change_comment_min: 10 });
    expect(settingsPatch(DEFAULTS, DEFAULTS)).toEqual({});
  });
  it("scopeLabel", () => {
    expect(scopeLabel({ card_title: null, terminal_name: null })).toBe("Любая карта · Любой филиал");
    expect(scopeLabel({ card_title: "Повар", terminal_name: "Тест Филиал 1" })).toBe("Повар · Тест Филиал 1");
  });
});
