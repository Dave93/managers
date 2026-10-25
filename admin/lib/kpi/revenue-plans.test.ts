import { describe, expect, it } from "bun:test";
import type { RevenuePlanRow } from "@admin/lib/kpi-api";
import { applySuggestions, parseGrowth, planChanges, planDraft, planPeriods } from "./revenue-plans";

const row = (terminal_id: string, amount: number | null, terminal_name = "Тест Филиал 1"): RevenuePlanRow =>
  ({ terminal_id, terminal_name, amount, has_iiko: true, updated_at: null });

describe("план выручки", () => {
  it("месяцы: два вперёд, текущий, одиннадцать назад", () => {
    const p = planPeriods(new Date("2026-10-25T10:00:00Z"));
    expect(p.slice(0, 4)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01", "2026-09-01"]);
    expect(p).toHaveLength(14);
  });
  it("подсказка заполняет только строки с выручкой прошлого года", () => {
    const d = planDraft([row("a", 1_000_000), row("b", null)]);
    expect(d).toEqual({ a: "1000000", b: "" });
    const r = applySuggestions(d, [
      { terminal_id: "a", base_period: "2025-10-01", base_revenue: 1_200_000, suggested: 1_320_000 },
      { terminal_id: "b", base_period: "2025-10-01", base_revenue: null, suggested: null },
    ]);
    expect(r).toEqual({ draft: { a: "1320000", b: "" }, filled: 1, missing: 1 });
  });
  it("изменения: только изменённые, пусто удаляет, ноль — ошибка", () => {
    const rows = [row("a", 1_000_000), row("b", null, "Тест Филиал 2"), row("c", 500_000)];
    expect(planChanges({ a: "1 000 000", b: "2 500 000", c: "" }, rows)).toEqual({
      items: [{ terminal_id: "b", amount: 2500000 }, { terminal_id: "c", amount: null }], errors: [],
    });
    expect(planChanges({ a: "1000000", b: "0", c: "500000" }, rows).errors).toEqual(["Тест Филиал 2: план — целое число больше 0"]);
  });
  it("план больше 10^12 — ошибка, незнакомые поля не трогаются", () => {
    const rows = [row("a", null)];
    expect(planChanges({ a: "1000000000001" }, rows).errors).toEqual(["Тест Филиал 1: план — не больше 1\u00a0000\u00a0000\u00a0000\u00a0000\u00a0сум"]);
    expect(planChanges({ a: "1000000000000" }, rows).items).toEqual([{ terminal_id: "a", amount: 1_000_000_000_000 }]);
    expect(planChanges({}, rows)).toEqual({ items: [], errors: [] });
    expect(applySuggestions({ a: "" }, [{ terminal_id: "zzz", base_period: "2025-10-01", base_revenue: 1, suggested: 1000 }])).toEqual({ draft: { a: "" }, filled: 0, missing: 0 });
  });
  it("рост", () => {
    expect([parseGrowth("10"), parseGrowth("7,5"), parseGrowth("-50"), parseGrowth("201"), parseGrowth("")]).toEqual([10, 7.5, -50, null, null]);
  });
});
