import { describe, expect, it } from "bun:test";
import * as B from "./branch-rules";
import type { BranchIndicator, BranchIndicatorCode, NoDataReason } from "./types";

const SEED: BranchIndicator[] = [
  { code: "sales", title_ru: "Продажи к плану", weight: 30, floor: 90, target: 100, max: 115, direction: "higher_better", active: true, sort: 10 },
  { code: "food_cost", title_ru: "Перерасход сырья", weight: 20, floor: 1, target: 0.5, max: 0.2, direction: "lower_better", active: true, sort: 20 },
  { code: "service", title_ru: "Заказы в норматив", weight: 20, floor: 80, target: 92, max: 97, direction: "higher_better", active: true, sort: 30 },
  { code: "sanitary", title_ru: "Санитарный чек-лист", weight: 15, floor: 80, target: 95, max: 100, direction: "higher_better", active: true, sort: 40 },
  { code: "discipline", title_ru: "Смены без опозданий", weight: 15, floor: 85, target: 95, max: 99, direction: "higher_better", active: true, sort: 50 },
];
const by = (c: BranchIndicatorCode) => SEED.find((i) => i.code === c)!;
const ok = (fact: number): B.FactResult => ({ fact, reason: null, details: {} });
const none = (reason: NoDataReason): B.FactResult => ({ fact: null, reason, details: {} });
const CONTROL = { sales: ok(103), food_cost: ok(0.6), service: ok(90), sanitary: ok(93), discipline: ok(94) };
const input = SEED.map(({ code, weight, floor, target, max, active }) => ({ code, weight, floor, target, max, active }));

describe("баллы показателя", () => {
  it("контрольный пример спеки: 104,0 / 90,0 / 91,67 / 93,33 / 95,0", () => {
    expect([
      B.indicatorPoints(by("sales"), 103), B.indicatorPoints(by("food_cost"), 0.6), B.indicatorPoints(by("service"), 90),
      B.indicatorPoints(by("sanitary"), 93), B.indicatorPoints(by("discipline"), 94),
    ]).toEqual([104, 90, 91.67, 93.33, 95]);
  });
  it("higher_better", () => {
    expect([89, 90, 95, 100, 107.5, 115, 200].map((f) => B.indicatorPoints(by("sales"), f))).toEqual([0, 0, 75, 100, 110, 120, 120]);
  });
  it("lower_better зеркально", () => {
    expect([1.5, 1, 0.75, 0.5, 0.35, 0.2, 0].map((f) => B.indicatorPoints(by("food_cost"), f))).toEqual([0, 0, 75, 100, 110, 120, 120]);
  });
});

describe("балл филиала", () => {
  it("контрольный пример: вклады 31,20 / 18,00 / 18,34 / 14,00 / 14,25 → 95,79, ступень 100 %", () => {
    const r = B.scoreTerminal(SEED, CONTROL);
    expect(r.rows.map((x) => [x.code, x.fact, x.points, x.weighted])).toEqual([
      ["sales", 103, 104, 31.2], ["food_cost", 0.6, 90, 18], ["service", 90, 91.67, 18.34],
      ["sanitary", 93, 93.33, 14], ["discipline", 94, 95, 14.25],
    ]);
    expect(r.score).toBe(95.79);
    expect(r.tier_pct).toBe(100);
    expect(B.nextTier(95.79)).toEqual({ tier_pct: 120, points_needed: 9.2 });
  });
  it("премия: 1 200 000 × 1,0 × 0,9 = 1 080 000", () => {
    expect(B.branchBonus(1_200_000, 100, 2)).toBe(1_080_000);
    expect(B.branchBonus(1_200_000, 60, 0)).toBe(720_000);
    expect(B.branchBonus(1_200_000, 0, 0)).toBe(0);
    expect([0, 1, 2, 3, 4, 5, 9].map(B.disciplineMultiplier)).toEqual([1, 0.9, 0.9, 0.75, 0.75, 0.5, 0.5]);
  });
  it("нет данных выпадает, веса пересчитываются (Σw = 85)", () => {
    const r = B.scoreTerminal(SEED, { ...CONTROL, sanitary: none("no_checks") });
    expect(r.rows.find((x) => x.code === "sanitary")).toMatchObject({ data_status: "no_data", points: null, weighted: null, reason: "no_checks" });
    expect(r.rows.filter((x) => x.weighted !== null).map((x) => x.weighted)).toEqual([36.71, 21.18, 21.58, 16.76]);
    expect(r.score).toBe(96.23);
  });
  it("ни одного показателя с данными — балла нет, не ноль", () => {
    const r = B.scoreTerminal(SEED, { sales: none("no_plan"), food_cost: none("no_store"), service: none("no_cooking_rows"), sanitary: none("no_checks"), discipline: none("no_attendance") });
    expect([r.score, r.tier_pct]).toEqual([null, null]);
  });
  it("неактивный показатель не пишется и не весит", () => {
    const list = SEED.map((i) => (i.code === "sanitary" ? { ...i, active: false } : i.code === "sales" ? { ...i, weight: 45 } : i));
    const r = B.scoreTerminal(list, CONTROL);
    expect(r.rows.map((x) => x.code)).toEqual(["sales", "food_cost", "service", "discipline"]);
    expect(r.score).toBe(97.39);
  });
  it("ступени и разрыв", () => {
    expect([74.99, 75, 89.99, 90, 104.99, 105, 130].map(B.tierFor)).toEqual([0, 60, 60, 100, 100, 120, 120]);
    expect(B.nextTier(104.96)).toEqual({ tier_pct: 120, points_needed: 0.1 });
    expect(B.nextTier(60)).toEqual({ tier_pct: 60, points_needed: 15 });
    expect(B.nextTier(105)).toBeNull();
  });
});

describe("факты филиала", () => {
  const X: B.TerminalInputs = {
    has_iiko: true, has_store: true, revenue: 1_030_000, plan: 1_000_000,
    recons: [{ status: "accepted", diff_bc: -6180 }],
    service: { orders: 10, on_time: 9, hall_min: 8, delivery_min: 12 },
    sanitary: { checks: 1, avg: 93 }, attendance: { days: 50, on_time: 47, late: 3, absent: 0 },
  };
  const f = (o: Partial<B.TerminalInputs>) => B.terminalFacts({ ...X, ...o });
  it("факты контрольного примера", () => {
    const r = B.terminalFacts(X);
    expect(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.fact]))).toEqual({ sales: 103, food_cost: 0.6, service: 90, sanitary: 93, discipline: 94 });
    expect(r.sales.details).toEqual({ revenue: 1030000, plan: 1000000 });
    expect(r.food_cost.details).toEqual({ revenue: 1030000, overspend: 6180, stores_total: 1, stores_reconciled: 1 });
    expect(r.discipline.details).toEqual({ days: 50, on_time: 47, late: 3, absent: 0 });
  });
  it("причины «нет данных»", () => {
    expect(f({ has_iiko: false }).sales.reason).toBe("no_iiko_link");
    expect(f({ plan: null }).sales).toMatchObject({ fact: null, reason: "no_plan" });
    expect(f({ plan: null }).food_cost.fact).toBe(0.6);
    expect(f({ revenue: 0 }).sales.reason).toBe("no_orders");
    expect(f({ revenue: 0 }).food_cost.reason).toBe("no_orders");
    expect(f({ has_store: false }).food_cost.reason).toBe("no_store");
    expect(f({ recons: [] }).food_cost.reason).toBe("no_reconciliation");
    expect(f({ recons: [{ status: "accepted", diff_bc: -100 }, { status: "ready", diff_bc: null }] }).food_cost.reason).toBe("not_accepted");
    expect(f({ recons: [{ status: "accepted", diff_bc: null }] }).food_cost.reason).toBe("no_iiko_document");
    // два склада, сверка только у одного: склад без строки считается непринятым
    const partial = f({ stores_total: 2, recons: [{ status: "accepted", diff_bc: -100 }] }).food_cost;
    expect([partial.fact, partial.reason, partial.details]).toEqual([null, "not_accepted", { stores_total: 2, stores_reconciled: 1 }]);
    expect(f({ stores_total: 2, recons: [{ status: "accepted", diff_bc: -100 }, { status: "accepted", diff_bc: -50 }] }).food_cost.details).toMatchObject({ stores_total: 2, stores_reconciled: 2, overspend: 150 });
    expect(f({ service: { ...X.service, orders: 0, on_time: 0 } }).service.reason).toBe("no_cooking_rows");
    expect(f({ sanitary: { checks: 0, avg: null } }).sanitary.reason).toBe("no_checks");
    expect(f({ attendance: { days: 0, on_time: 0, late: 0, absent: 0 } }).discipline.reason).toBe("no_attendance");
  });
  it("перерасход чистый и не отрицательный", () => {
    expect(f({ recons: [{ status: "accepted", diff_bc: 500 }] }).food_cost.fact).toBe(0);
    expect(f({ recons: [{ status: "accepted", diff_bc: -3000 }, { status: "accepted", diff_bc: 1000 }] }).food_cost.details.overspend).toBe(2000);
  });
  it("pct2 и monthLastDay", () => {
    expect([B.pct2(9, 10), B.pct2(1, 3), B.pct2(2, 3), B.pct2(1, 0)]).toEqual([90, 33.33, 66.67, null]);
    expect(["2026-02-01", "2028-02-01", "2026-12-01"].map(B.monthLastDay)).toEqual(["2026-02-28", "2028-02-29", "2026-12-31"]);
  });
});

describe("ввод", () => {
  it("validateIndicators", () => {
    expect("ok" in B.validateIndicators(input, SEED)).toBe(true);
    expect(B.validateIndicators(input.slice(0, 4), SEED)).toMatchObject({ error: "unknown_indicator" });
    expect(B.validateIndicators([...input.slice(0, 4), { ...input[4], code: "nps" }], SEED)).toMatchObject({ error: "unknown_indicator" });
    expect(B.validateIndicators(input.map((i) => (i.code === "sales" ? { ...i, weight: 30.5 } : i)), SEED)).toEqual({ error: "bad_indicator_weight", extra: { code: "sales" } });
    expect(B.validateIndicators(input.map((i) => (i.code === "food_cost" ? { ...i, floor: 0.5, target: 1 } : i)), SEED)).toEqual({ error: "bad_thresholds", extra: { code: "food_cost" } });
    expect(B.validateIndicators(input.map((i) => (i.code === "sales" ? { ...i, max: 100 } : i)), SEED)).toEqual({ error: "bad_thresholds", extra: { code: "sales" } });
    expect(B.validateIndicators(input.map((i) => (i.code === "discipline" ? { ...i, weight: 14 } : i)), SEED)).toEqual({ error: "weights_sum", extra: { sum: 99 } });
    expect(B.validateIndicators(input.map((i) => (i.code === "sanitary" ? { ...i, active: false } : i)), SEED)).toEqual({ error: "weights_sum", extra: { sum: 85 } });
    const off = input.map((i) => (i.code === "sanitary" ? { ...i, active: false } : i.code === "sales" ? { ...i, weight: 45 } : i));
    expect("ok" in B.validateIndicators(off, SEED)).toBe(true);
  });
  it("настройки балла", () => {
    expect(B.DEFAULT_BRANCH_SETTINGS).toEqual({
      service_norm_hall_min: 8, service_norm_delivery_min: 12,
      sanitary_items: ["Чистота", "Санитария", "Форма персонала", "Хранение продуктов", "Маркировка"],
    });
    expect(B.validateBranchSettingsPatch({ service_norm_hall_min: 10 })).toBeNull();
    for (const v of [0, 121, 7.5, "8"]) expect(B.validateBranchSettingsPatch({ service_norm_delivery_min: v })).toBe("bad_value");
    expect(B.validateBranchSettingsPatch({ foo: 1 })).toBe("unknown_setting");
    for (const v of [[], ["a", " a "], ["", "x"], ["x".repeat(201)], [1], Array.from({ length: 31 }, (_, i) => `п${i}`)]) {
      expect(B.validateBranchSettingsPatch({ sanitary_items: v })).toBe("bad_sanitary_items");
    }
  });
  it("coversTerminal: филиал совпадает или пуст, карта любая", () => {
    expect(B.coversTerminal([{ card_id: "cook", terminal_id: "t1" }], "t1")).toBe(true);
    expect(B.coversTerminal([{ card_id: "cook", terminal_id: null }], "t9")).toBe(true);
    expect(B.coversTerminal([{ card_id: null, terminal_id: "t2" }], "t1")).toBe(false);
    expect(B.coversTerminal([], "t1")).toBe(false);
  });
  it("пункты проверки", () => {
    expect(B.parseSanitaryItems([{ title: " Чистота ", ok: true }, { title: "Форма персонала", ok: false }])).toEqual([{ title: "Чистота", ok: true }, { title: "Форма персонала", ok: false }]);
    for (const bad of [null, [], [{ title: "", ok: true }], [{ title: "x", ok: "yes" }], [{ title: "x".repeat(201), ok: true }], Array.from({ length: 31 }, () => ({ title: "x", ok: true }))]) {
      expect(B.parseSanitaryItems(bad)).toBeNull();
    }
    expect(B.sanitaryPct([{ title: "a", ok: true }, { title: "b", ok: true }, { title: "c", ok: false }])).toBe(66.67);
  });
});

describe("предложения", () => {
  it("автопункты карты", () => {
    expect(B.branchSuggestion("sales_plan", { fact: 103, points: 104 })).toEqual({ score: 100, basis: "Филиал: продажи 103% плана → 104,0 балла" });
    expect(B.branchSuggestion("food_cost", { fact: 0.6, points: 90 })).toEqual({ score: 90, basis: "Филиал: перерасход сырья 0,6% выручки → 90,0 балла" });
    expect(B.branchSuggestion("cooking_speed", { fact: 90, points: 91.67 })).toEqual({ score: 92, basis: "Филиал: заказов в норматив 90% → 91,7 балла" });
    expect(B.branchSuggestion("cooking_speed", { fact: 85.25, points: 70.83 }).basis).toBe("Филиал: заказов в норматив 85,25% → 70,8 балла");
  });
  it("план от прошлого года", () => {
    expect(B.planSuggestion(12_345_678, 10)).toBe(13_580_000);
    expect([B.planSuggestion(null, 10), B.planSuggestion(0, 10)]).toEqual([null, null]);
    expect([B.planSuggestion(1499, 0), B.planSuggestion(1500, 0)]).toEqual([1000, 2000]);
  });
});

describe("округление и ввод (исправления)", () => {
  const service = by("service");
  it("половина вверх без плавающих хвостов", () => {
    expect(B.pct2(174, 8000)).toBe(2.18);
    expect(B.indicatorPoints(service, 80.21)).toBe(50.88);
    expect([B.roundTo(18.335, 2), B.roundTo(0.125, 2), B.roundTo(14.55, 1)]).toEqual([18.34, 0.13, 14.6]);
  });
  it("разрыв до ступени округляется половиной вверх", () => {
    expect(B.nextTier(60.45)).toEqual({ tier_pct: 60, points_needed: 14.6 });
  });
  it("ключи прототипа — неизвестные настройки", () => {
    expect(B.validateBranchSettingsPatch(JSON.parse('{"constructor":5}'))).toBe("unknown_setting");
    expect(B.validateBranchSettingsPatch(JSON.parse('{"__proto__":5}'))).toBe("unknown_setting");
    expect(B.validateBranchSettingsPatch(JSON.parse('{"toString":5}'))).toBe("unknown_setting");
  });
  it("нечисловой факт — нет данных, не 120", () => {
    expect(() => B.indicatorPoints(service, Number.NaN)).toThrow();
    expect(() => B.indicatorPoints(service, Infinity)).toThrow();
    const r = B.scoreTerminal(SEED, { ...CONTROL, sales: ok(Infinity), sanitary: ok(Number.NaN) });
    expect(r.rows.find((x) => x.code === "sales")).toMatchObject({ data_status: "no_data", points: null, weighted: null, fact: null });
    expect(r.rows.filter((x) => x.data_status === "ok").length).toBe(3);
  });
  it("средний процент санитарии округляется", () => {
    const X: B.TerminalInputs = {
      has_iiko: true, has_store: true, revenue: 1, plan: 1, recons: [],
      service: { orders: 1, on_time: 1, hall_min: 8, delivery_min: 12 },
      sanitary: { checks: 3, avg: 93.3333333 }, attendance: { days: 1, on_time: 1, late: 0, absent: 0 },
    };
    expect(B.terminalFacts(X).sanitary.fact).toBe(93.33);
  });
});
