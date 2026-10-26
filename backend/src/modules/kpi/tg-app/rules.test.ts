import { describe, expect, it } from "bun:test";
import type { TgMonth } from "./types";
import { quarterRow } from "../rules";
import { disputeStateOf, lostItems, monthState, needPct, quarterEnded, raiseHint, raiseQuarter, reviewStatusOf } from "./rules";

const T = [{ min_pct: 95, amount: 500000 }, { min_pct: 90, amount: 300000 }, { min_pct: 85, amount: 150000 }];
const m = (period: string, state: TgMonth["state"], score_pct: number | null = null): TgMonth => ({ period, state, score_pct, opens_at: "x" });
const q4 = (a: TgMonth["state"], av: number | null, b: TgMonth["state"], bv: number | null, c: TgMonth["state"], cv: number | null = null) =>
  [m("2026-10-01", a, av), m("2026-11-01", b, bv), m("2026-12-01", c, cv)];
// open — прошлые месяцы без отправленной оценки, ещё не закрытые HR; по умолчанию 0 (все закрыты)
const hint = (months: TgMonth[], o: { tiers?: typeof T; min?: number; ended?: boolean; decision?: { amount: number } | null; open?: number } = {}) =>
  raiseHint({ months, tiers: o.tiers ?? T, minMonths: o.min ?? 2, ended: o.ended ?? false, decision: o.decision ?? null, openPast: o.open ?? 0 });

describe("needPct", () => {
  it("примеры спеки и округление вверх без плавающего хвоста", () => {
    expect(needPct(95, [90.3], 2)).toBe(97.4);
    expect(needPct(90, [90.3, 93], 1)).toBe(86.7);
    expect(needPct(95, [90.3, 93], 1)).toBe(101.7);
    expect(needPct(85, [80], 2)).toBe(87.5);
    expect(needPct(85, [80, 85.2], 1)).toBe(89.8);   // наивный Math.ceil по float даёт 89.9
    expect(needPct(95, [91.43], 2)).toBe(96.8);      // 967.85 → вверх
  });
  it("зеркалит round2 начисления: порог берётся с половиной сотой на месяц", () => {
    // сырая формула давала 86,8; при 86,7 среднее 90,0 (round2 от 89,996…)
    expect(needPct(90, [90.3, 92.99], 1)).toBe(86.7);
    expect(quarterRow([90.3, 92.99, 86.7], T, 2).avg_pct).toBeGreaterThanOrEqual(90);
    expect(quarterRow([90.3, 92.99, 86.6], T, 2).avg_pct).toBeLessThan(90);
    // сырая формула давала «недостижимо», а 100 в оставшихся месяцах ступень берёт
    expect(needPct(95, [92, 92.99], 1)).toBe(100);
    expect(quarterRow([92, 92.99, 100], T, 2).avg_pct).toBeGreaterThanOrEqual(95);
    expect(needPct(95, [84.99], 2)).toBe(100);
    expect(quarterRow([84.99, 100, 100], T, 2).avg_pct).toBeGreaterThanOrEqual(95);
  });
  it("hint: 100 в оставшихся месяцах — достижимо, а не «уже не получится»", () => {
    expect(hint(q4("scored", 92, "scored", 92.99, "upcoming"))).toMatchObject({ kind: "running", next: { amount: 500000, reachable: true, need_pct: 100 } });
  });
});

describe("raiseHint", () => {
  it("макет 1: октябрь 90,3 — k=1 < min, «выйдет 300 000», для 500 000 — 97,4 за ноябрь и декабрь", () => {
    expect(hint(q4("scored", 90.3, "upcoming", null, "upcoming"))).toEqual({
      kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-10-01"], amount: 300000,
      next: { amount: 500000, reachable: true, need_pct: 97.4, periods: ["2026-11-01", "2026-12-01"] },
    });
  });
  it("макет 2: октябрь 90,3 и ноябрь 93,0 — «сейчас 300 000», сохранится от 86,7, 500 000 недостижимо", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"))).toEqual({
      kind: "running", amount: 300000, keep: { need_pct: 86.7, periods: ["2026-12-01"] }, next: { amount: 500000, reachable: false },
    });
  });
  it("пример спеки: 80 % — для 150 000 в среднем 87,5 за ноябрь и декабрь", () => {
    expect(hint(q4("scored", 80, "upcoming", null, "upcoming"))).toMatchObject({
      kind: "too_few", amount: 0, next: { amount: 150000, reachable: true, need_pct: 87.5, periods: ["2026-11-01", "2026-12-01"] },
    });
  });
  it("k + |R| < min в идущем квартале, прошлые месяцы закрыты — impossible, при k + |R| = min — по-прежнему too_few", () => {
    expect(hint(q4("not_rated", null, "not_rated", null, "scored", 90.3))).toEqual({ kind: "impossible", scored: 1, min_months: 2 });
    expect(hint(q4("not_rated", null, "scored", 90.3, "upcoming"), { min: 3 })).toEqual({ kind: "impossible", scored: 1, min_months: 3 });
    expect(hint(q4("not_rated", null, "not_rated", null, "upcoming"))).toEqual({ kind: "impossible", scored: 0, min_months: 2 });
    expect(hint(q4("not_rated", null, "scored", 90.3, "upcoming")).kind).toBe("too_few");
    expect(hint(q4("not_rated", null, "not_rated", null, "scored", 90.3), { ended: true })).toMatchObject({ kind: "waiting_hr" });
  });
  it("прошлый открытый неоценённый месяц не даёт impossible: оценку ещё пришлют с опозданием", () => {
    // декабрь оценён, октябрь и ноябрь без оценки: k = 1, R пусто
    const q = q4("not_rated", null, "not_rated", null, "scored", 90.3);
    expect(hint(q, { open: 1 })).toEqual({ kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-12-01"], amount: 300000, next: null });
    expect(hint(q, { open: 2 })).toMatchObject({ kind: "too_few" });
    // тот же месяц закрыт HR — прибавки не будет
    expect(hint(q, { open: 0 })).toEqual({ kind: "impossible", scored: 1, min_months: 2 });
    // min = 3: октябрь открыт — too_few, need по-прежнему только по R (99,7, а не 97,4)
    const q3 = q4("not_rated", null, "scored", 90.3, "upcoming");
    expect(hint(q3, { min: 3, open: 1 })).toMatchObject({
      kind: "too_few", scored: 1, min_months: 3, next: { amount: 500000, reachable: true, need_pct: 99.7, periods: ["2026-12-01"] },
    });
    expect(hint(q3, { min: 3, open: 0 })).toEqual({ kind: "impossible", scored: 1, min_months: 3 });
    // k = 0 при открытых прошлых — none; закрыты — impossible; квартал кончился — waiting_hr
    const q0 = q4("not_rated", null, "not_rated", null, "pending");
    expect([hint(q0, { open: 2 }), hint(q0, { open: 0 })]).toEqual([{ kind: "none" }, { kind: "impossible", scored: 0, min_months: 2 }]);
    expect(hint(q, { open: 2, ended: true })).toEqual({ kind: "waiting_hr", amount: 0 });
  });
  it("k = 0 — none", () => expect(hint(q4("pending", null, "upcoming", null, "upcoming"))).toEqual({ kind: "none" }));
  it("верхняя ступень — строки «для» нет; |R| = 0 — нет ни «для», ни «сохранится»", () => {
    expect(hint(q4("scored", 96, "scored", 97, "upcoming"))).toEqual({ kind: "running", amount: 500000, keep: { need_pct: 92, periods: ["2026-12-01"] }, next: null });
    expect(hint(q4("scored", 90.3, "scored", 93, "scored", 91))).toEqual({ kind: "running", amount: 300000, keep: null, next: null });
  });
  it("«сохранится» нет при need ≤ 0 и при нулевой ступени", () => {
    expect(hint(q4("scored", 100, "scored", 100, "upcoming"), { tiers: [{ min_pct: 50, amount: 100000 }] }))
      .toEqual({ kind: "running", amount: 100000, keep: null, next: null });                        // (150 − 200) / 1 < 0
    expect((hint(q4("scored", 80, "scored", 82, "upcoming")) as any).keep).toBeNull();              // ступени нет
  });
  it("прошлый неоценённый месяц не входит в R", () => {
    // (95 × 2 − 90,3) / 1 = 99,7; с октябрём в R было бы 97,4
    expect(hint(q4("not_rated", null, "scored", 90.3, "upcoming"))).toMatchObject({
      kind: "too_few", next: { amount: 500000, reachable: true, need_pct: 99.7, periods: ["2026-12-01"] },
    });
  });
  it("квартал кончился без решения — waiting_hr с предложением; мало месяцев — 0", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "not_rated"), { ended: true })).toEqual({ kind: "waiting_hr", amount: 300000 });
    expect(hint(q4("scored", 90.3, "not_rated", null, "not_rated"), { ended: true })).toEqual({ kind: "waiting_hr", amount: 0 });
  });
  it("решение HR важнее всего", () => {
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { decision: { amount: 500000 } })).toEqual({ kind: "decided", amount: 500000 });
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { ended: true, decision: { amount: 0 } })).toEqual({ kind: "decided", amount: 0 });
  });
  it("изменённые HR ступени и min = 3", () => {
    const t2 = [{ min_pct: 80, amount: 200000 }, { min_pct: 92, amount: 400000 }];
    expect(hint(q4("scored", 90.3, "upcoming", null, "upcoming"), { tiers: t2 })).toMatchObject({
      amount: 200000, next: { amount: 400000, reachable: true, need_pct: 92.9 },
    });
    expect(hint(q4("scored", 90.3, "scored", 93, "upcoming"), { min: 3 })).toMatchObject({
      kind: "too_few", scored: 2, min_months: 3, keep_periods: ["2026-10-01", "2026-11-01"],
    });
  });
});

describe("месяцы и квартал", () => {
  const at = new Date("2026-10-26T05:00:00.000Z");
  it("monthState", () => {
    expect(monthState("2026-10-01", "2026-10-01", at, { score_pct: 90.3 })).toEqual({ period: "2026-10-01", state: "scored", score_pct: 90.3, opens_at: "2026-10-19T19:00:00.000Z" });
    expect(monthState("2026-10-01", "2026-10-01", at, null).state).toBe("pending");
    expect(monthState("2026-11-01", "2026-10-01", at, null).state).toBe("upcoming");
    expect(monthState("2026-09-01", "2026-10-01", at, null).state).toBe("not_rated");
    expect(monthState("2026-10-01", "2026-10-01", at, { score_pct: null }).state).toBe("not_rated");
  });
  it("quarterEnded и raiseQuarter", () => {
    expect([quarterEnded("2026-07-01", "2026-10-01"), quarterEnded("2026-10-01", "2026-12-01")]).toEqual([true, false]);
    expect(raiseQuarter("2026-10-01", (q) => q === "2026-07-01")).toBe("2026-07-01");
    expect(raiseQuarter("2026-10-01", (q) => q === "2026-07-01" || q === "2026-10-01")).toBe("2026-10-01");
    expect(raiseQuarter("2026-10-01", () => false)).toBe("2026-10-01");
  });
});

describe("карточка месяца", () => {
  it("lostItems: ниже 100, по возрастанию, ничья по sort, до трёх", () => {
    const row = (id: string, score: number | null, sort: number) => ({ item_id: id, title_ru: id, title_uz: id, score, sort });
    expect(lostItems([row("a", 100, 10), row("b", 75, 60), row("c", null, 20), row("d", 75, 30), row("e", 90, 50), row("f", 95, 40)]).map((x) => x.item_id))
      .toEqual(["d", "b", "e"]);
    expect(lostItems([row("a", 100, 10)])).toEqual([]);
  });
  it("reviewStatusOf и disputeStateOf — порядок веток", () => {
    expect(reviewStatusOf({ open: true, resolved: true, changed: true })).toBe("dispute_open");
    expect(reviewStatusOf({ open: false, resolved: true, changed: true })).toBe("dispute_resolved");
    expect(reviewStatusOf({ open: false, resolved: false, changed: true })).toBe("changed");
    expect(reviewStatusOf({ open: false, resolved: false, changed: false })).toBe("ready");
    const d = new Date("2026-11-10T18:59:59.999Z");
    const s = (o: Partial<Parameters<typeof disputeStateOf>[0]>) =>
      disputeStateOf({ cancelled: false, open: false, periodClosed: false, deadline: d, at: new Date("2026-11-01T00:00:00Z"), ...o });
    expect([s({ cancelled: true, open: true }), s({ open: true, periodClosed: true }), s({ periodClosed: true }), s({ at: new Date("2026-11-11T00:00:00Z") }), s({})])
      .toEqual(["cancelled", "open", "period_closed", "window_closed", "can"]);
  });
});
