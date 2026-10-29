import { describe, expect, it } from "bun:test";
import { canChooseDocument } from "./reconcile";

describe("canChooseDocument", () => {
  const cand = { id: "d1", num: "1", comment: "Месяц", date: "2026-08-31", shortage_sum: 0, surplus_sum: 0 };
  it("кандидаты есть — выбор доступен при любом статусе (в т.ч. когда загруженный документ пропал)", () => {
    expect(canChooseDocument({ status: "needs_choice", iiko_candidates: [cand] })).toBe(true);
    expect(canChooseDocument({ status: "ready", iiko_candidates: [cand] })).toBe(true);
    expect(canChooseDocument({ status: "accepted", iiko_candidates: [cand] })).toBe(true);
  });
  it("кандидатов нет — выбора нет", () => {
    expect(canChooseDocument({ status: "needs_choice", iiko_candidates: [] })).toBe(false);
    expect(canChooseDocument({ status: "ready", iiko_candidates: null })).toBe(false);
  });
});
