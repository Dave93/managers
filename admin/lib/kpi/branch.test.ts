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
  it("цвет ячейки по баллам, как их показывает экран (до 0,1)", () => {
    expect(B.cellTone({ points: 99.96, data_status: "ok" })).toBe("green");
    expect(B.cellTone({ points: 99.94, data_status: "ok" })).toBe("amber");
    expect(B.cellTone({ points: 0.04, data_status: "ok" })).toBe("red");
    expect(B.cellTone({ points: 0.05, data_status: "ok" })).toBe("amber");
  });
  it("ступени, средний балл", () => {
    expect(B.tierCounts([{ tier_pct: 100 }, { tier_pct: 120 }, { tier_pct: 100 }, { tier_pct: 0 }])).toEqual([{ pct: 120, count: 1 }, { pct: 100, count: 2 }, { pct: 60, count: 0 }, { pct: 0, count: 1 }]);
    expect([B.tierTone(120), B.tierTone(100), B.tierTone(60), B.tierTone(0), B.tierTone(null)]).toEqual(["blue", "green", "amber", "red", "gray"]);
    expect(B.networkAverage([{ score: 95.79 }, { score: 100 }, { score: 80 }])).toBe(91.93);
    expect(B.networkAverage([])).toBeNull();
  });
  it("округление половины вверх, как на backend", () => {
    expect([B.formatPoints(1.15), B.formatPoints(0.35), B.formatPoints(91.67)]).toEqual(["1,2", "0,4", "91,7"]);
    expect([B.formatScore(1.005), B.formatScore(95.785)]).toEqual(["1,01", "95,79"]);
    expect(B.nextTierText({ tier_pct: 100, points_needed: 1.15 })).toBe("До ступени 100\u00a0% не хватает 1,2 балла");
    expect(B.networkAverage([{ score: 1.005 }])).toBe(1.01);
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
    expect(B.branchSettingsIssues({ hall: "8", delivery: "12", items: ["Чистота", "  "] })).toEqual(["Пункт проверки не может быть пустым"]);
    expect(B.parseDecimal(" 0,5 ")).toBe(0.5);
    expect(B.parseDecimal("x")).toBeNull();
  });
});

describe("предварительная версия, покрытие, склады, проверки (финальные исправления)", () => {
  const NB = " ";
  it("месяц по умолчанию — последний завершённый; текущий месяц — не завершён", () => {
    const now = new Date("2026-10-25T10:00:00Z");
    expect(B.defaultBranchPeriod(now)).toBe("2026-09-01");
    // 31 октября 19:30 UTC — уже 1 ноября по Ташкенту
    expect(B.defaultBranchPeriod(new Date("2026-10-31T19:30:00Z"))).toBe("2026-10-01");
    expect(B.defaultBranchPeriod(new Date("2026-01-10T10:00:00Z"))).toBe("2025-12-01");
    expect([B.monthIncomplete("2026-10-01", now), B.monthIncomplete("2026-09-01", now), B.monthIncomplete("2026-11-01", now)]).toEqual([true, false, true]);
  });
  it("тексты пометки и подтверждения", () => {
    expect(B.PRELIMINARY_TEXT).toBe("Предварительно: месяц ещё не закончился, продажи к месячному плану занижены. Пересчитайте после окончания месяца");
    expect(B.COMPUTE_CONFIRM_TEXT).toBe("Месяц ещё не закончился — результат будет предварительным. Посчитать?");
  });
  it("покрытие балла по весу и фактический вес", () => {
    const full = [{ weight: 30, data_status: "ok" as const }, { weight: 70, data_status: "ok" as const }];
    // санитарии нет: данные у 85 % веса
    const part = [
      { weight: 30, data_status: "ok" as const }, { weight: 20, data_status: "ok" as const }, { weight: 20, data_status: "ok" as const },
      { weight: 15, data_status: "no_data" as const }, { weight: 15, data_status: "ok" as const },
    ];
    expect([B.weightCoverage(full), B.weightCoverage(part), B.weightCoverage([])]).toEqual([100, 85, null]);
    expect(B.weightCoverage([{ weight: 1, data_status: "ok" }, { weight: 2, data_status: "no_data" }])).toBe(33.3);
    expect([B.coverageText(full), B.coverageText([]), B.coverageText(part)]).toEqual(["", "", `по 85${NB}% веса`]);
    expect(B.coverageText([{ weight: 1, data_status: "ok" }, { weight: 2, data_status: "no_data" }])).toBe(`по 33,3${NB}% веса`);
    expect(B.weightText(30, full)).toBe(`вес 30${NB}%`);
    expect(B.weightText(15, part)).toBe(`вес 15${NB}% → фактически 17,6${NB}%`);
    expect(B.indicatorLine({ points: 95, weight: 15, weighted: 16.76 }, part)).toBe(`95,0 балла · вес 15${NB}% → фактически 17,6${NB}% · вклад 16,76`);
    expect(B.indicatorLine({ points: 104, weight: 30, weighted: 31.2 }, full)).toBe(`104,0 балла · вес 30${NB}% · вклад 31,20`);
  });
  it("себестоимость без данных: принято N из M складов", () => {
    expect(B.noDataDetailsText("food_cost", "not_accepted", { stores_total: 2, stores_reconciled: 1 })).toBe("принято 1 из 2 складов");
    expect(B.noDataDetailsText("food_cost", "no_reconciliation", { stores_total: 1, stores_reconciled: 0 })).toBe("принято 0 из 1 склада");
    expect(B.noDataDetailsText("food_cost", "not_accepted", { stores_total: 21, stores_reconciled: 3 })).toBe("принято 3 из 21 склада");
    expect(B.noDataDetailsText("food_cost", "not_accepted", { stores_total: 11, stores_reconciled: 3 })).toBe("принято 3 из 11 складов");
    expect(B.noDataDetailsText("food_cost", "no_store", {})).toBe("");
    expect(B.noDataDetailsText("food_cost", "not_accepted", { stores_total: 2 })).toBe("");
    expect(B.noDataDetailsText("sales", "not_accepted", { stores_total: 2, stores_reconciled: 1 })).toBe("");
    expect(B.noDataDetailsText("food_cost", null, { stores_total: 2, stores_reconciled: 1 })).toBe("");
  });
  it("санитарная проверка после расчёта войдёт в следующий пересчёт", () => {
    const at = "2026-10-20T10:00:00.000Z";
    expect(B.countedLater({ created_at: "2026-10-20T10:00:00.001Z" }, at)).toBe(true);
    expect(B.countedLater({ created_at: at }, at)).toBe(false);
    expect(B.countedLater({ created_at: "2026-10-19T10:00:00.000Z" }, at)).toBe(false);
    expect(B.countedLater({ created_at: "2026-10-21T10:00:00.000Z" }, null)).toBe(false);
  });
});
