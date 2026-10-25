import { describe, expect, it } from "bun:test";
import type { BranchIndicator } from "@admin/lib/kpi-api";
import * as B from "./branch";

const seed: BranchIndicator[] = [
  { code: "sales", title_ru: "Продажи к плану", weight: 30, floor: 90, target: 100, max: 115, direction: "higher_better", active: true, sort: 10 },
  { code: "food_cost", title_ru: "Перерасход сырья", weight: 20, floor: 1, target: 0.5, max: 0.2, direction: "lower_better", active: true, sort: 20 },
  { code: "service", title_ru: "Заказы в норматив", weight: 20, floor: 80, target: 92, max: 97, direction: "higher_better", active: true, sort: 30 },
  { code: "sanitary", title_ru: "Санитарный чек-лист", weight: 15, floor: 80, target: 95, max: 100, direction: "higher_better", active: true, sort: 40 },
  { code: "discipline", title_ru: "Смены без опозданий", weight: 15, floor: 85, target: 95, max: 99, direction: "higher_better", active: true, sort: 50 },
];

describe("сеть", () => {
  it("цвет ячейки по баллам", () => {
    expect(B.cellTone({ points: 104, data_status: "ok" })).toBe("green");
    expect(B.cellTone({ points: 100, data_status: "ok" })).toBe("green");
    expect(B.cellTone({ points: 91.67, data_status: "ok" })).toBe("amber");
    expect(B.cellTone({ points: 0, data_status: "ok" })).toBe("red");
    expect(B.cellTone({ points: null, data_status: "no_data" })).toBe("gray");
    expect(B.cellTone(undefined)).toBe("gray");
  });
  it("ступени, средний балл", () => {
    expect(B.tierCounts([{ tier_pct: 100 }, { tier_pct: 120 }, { tier_pct: 100 }, { tier_pct: 0 }])).toEqual([{ pct: 120, count: 1 }, { pct: 100, count: 2 }, { pct: 60, count: 0 }, { pct: 0, count: 1 }]);
    expect([B.tierTone(120), B.tierTone(100), B.tierTone(60), B.tierTone(0), B.tierTone(null)]).toEqual(["blue", "green", "amber", "red", "gray"]);
    expect(B.networkAverage([{ score: 95.79 }, { score: 100 }, { score: 80 }])).toBe(91.93);
    expect(B.networkAverage([])).toBeNull();
  });
  it("форматы", () => {
    expect([B.formatFact(103), B.formatFact(0.6), B.formatFact(null)]).toEqual(["103 %", "0,6 %", "нет данных"]);
    expect([B.formatPoints(91.67), B.formatPoints(104), B.formatPoints(null)]).toEqual(["91,7", "104,0", "—"]);
    expect([B.formatScore(95.79), B.formatScore(100), B.formatScore(null)]).toEqual(["95,79", "100,00", "—"]);
    expect(B.nextTierText({ tier_pct: 120, points_needed: 9.2 })).toBe("До ступени 120 % не хватает 9,2 балла");
    expect(B.nextTierText(null)).toBe("Высшая ступень");
    expect(B.detailsText("sales", { revenue: 1030000, plan: 1000000 })).toBe("Выручка 1 030 000 сум при плане 1 000 000 сум");
    expect(B.detailsText("service", { orders: 10, on_time: 9, hall_min: 8, delivery_min: 12 })).toBe("В норматив 9 из 10 заказов · зал 8 мин, доставка 12 мин");
    expect(B.detailsText("sales", { revenue: 500000 })).toBe("");
  });
});

describe("настройки балла", () => {
  it("стартовые проходят", () => {
    const d = B.indicatorDraft(seed);
    expect(B.indicatorIssues(d)).toEqual([]);
    expect(B.weightSum(d)).toBe(100);
    expect(B.indicatorBody(d)[1]).toEqual({ code: "food_cost", weight: 20, floor: 1, target: 0.5, max: 0.2, active: true });
  });
  it("ошибки по порядку строк", () => {
    const d = B.indicatorDraft(seed).map((x) =>
      x.code === "food_cost" ? { ...x, floor: "0,5", target: "1" } : x.code === "discipline" ? { ...x, weight: "14" } : x);
    expect(B.indicatorIssues(d)).toEqual(["Перерасход сырья: нужно порог > цель > максимум", "Сумма весов активных показателей 99 %, нужно 100 %"]);
    const off = B.indicatorDraft(seed).map((x) => (x.code === "sanitary" ? { ...x, active: false } : x.code === "sales" ? { ...x, weight: "45" } : x));
    expect(B.indicatorIssues(off)).toEqual([]);
    expect(B.indicatorIssues(B.indicatorDraft(seed).map((x) => (x.code === "sales" ? { ...x, weight: "0" } : x)))[0]).toBe("Продажи к плану: у активного показателя вес не меньше 1");
  });
  it("пункты проверки и нормативы", () => {
    expect(B.sanitaryItemsFromText(" Чистота \n\nФорма персонала\nЧистота")).toEqual(["Чистота", "Форма персонала"]);
    expect(B.branchSettingsIssues({ hall: "8", delivery: "12", items: ["Чистота"] })).toEqual([]);
    expect(B.branchSettingsIssues({ hall: "0", delivery: "12,5", items: [] })).toEqual([
      "Норматив зала — целое от 1 до 120 минут", "Норматив доставки — целое от 1 до 120 минут", "Пунктов проверки — от 1 до 30",
    ]);
    expect(B.parseDecimal(" 0,5 ")).toBe(0.5);
    expect(B.parseDecimal("x")).toBeNull();
  });
});
