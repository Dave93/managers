import { describe, expect, it } from "bun:test";
import type { EmployeeRow } from "@admin/lib/kpi-api";
import { ALL, cardOptions, employeeName, filterRows, statusCounts, terminalOptions } from "./filters";

const row = (o: Partial<EmployeeRow> & { id: string }): EmployeeRow => ({
  first_name: "Тест", last_name: "Повар", terminal_id: "t1", terminal_name: "Тест Филиал 1", staff_role_code: "cook",
  staff_role_name: "Повар", active: true, external_id: null, card: { id: "c-cook", code: "cook", title_ru: "Повар" },
  card_source: "role", review: null, open_dispute: false, can_evaluate: true, ...o,
});
const rows = [
  row({ id: "a", terminal_id: "t2", terminal_name: "Б филиал" }),
  row({ id: "b", last_name: "Кассир", terminal_id: "t1", terminal_name: "А филиал", card: { id: "c-cash", code: "cashier", title_ru: "Кассир" },
        review: { id: "r1", status: "draft", score_pct: null, submitted_at: null, late: false } }),
  row({ id: "c", last_name: "Старший", terminal_id: "t2", terminal_name: "Б филиал", open_dispute: true,
        review: { id: "r2", status: "submitted", score_pct: 90, submitted_at: "2026-11-02T10:00:00.000Z", late: false } }),
];
const all = { terminal_id: ALL, card_id: ALL, status: ALL, search: "" } as const;

describe("filters", () => {
  it("terminalOptions: уникальные, по имени, без имени", () => {
    expect(terminalOptions(rows)).toEqual([{ id: "t1", name: "А филиал" }, { id: "t2", name: "Б филиал" }]);
    expect(terminalOptions([{ terminal_id: "t9", terminal_name: null }])).toEqual([{ id: "t9", name: "Филиал без названия" }]);
  });
  it("cardOptions", () => expect(cardOptions(rows)).toEqual([{ id: "c-cash", name: "Кассир" }, { id: "c-cook", name: "Повар" }]));
  it("filterRows", () => {
    expect(filterRows(rows, all).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(filterRows(rows, { ...all, terminal_id: "t2" }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterRows(rows, { ...all, card_id: "c-cash" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, { ...all, status: "none" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, { ...all, status: "disputed" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterRows(rows, { ...all, search: "кас тес" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, { ...all, search: "   " }).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("statusCounts и employeeName", () => {
    expect(statusCounts(rows)).toEqual({ none: 1, draft: 1, submitted: 0, disputed: 1 });
    expect(employeeName({ first_name: " Тест ", last_name: "Повар" })).toBe("Повар Тест");
  });
});
