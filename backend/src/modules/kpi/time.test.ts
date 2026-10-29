import { describe, expect, it } from "bun:test";
import * as T from "./time";

describe("kpi time", () => {
  it("isPeriod", () => {
    expect(T.isPeriod("2026-10-01")).toBe(true);
    for (const bad of ["2026-10-15", "2026-13-01", "2026-1-01", "", null, 5]) expect(T.isPeriod(bad)).toBe(false);
  });
  it("periodOf по Ташкенту", () => {
    expect(T.periodOf(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11-01"); // 00:30 1 ноября в Ташкенте
    expect(T.periodOf(new Date("2026-10-31T18:59:59Z"))).toBe("2026-10-01");
  });
  it("addMonths через год", () => {
    expect(T.addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(T.addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
  it("сроки октября", () => {
    expect(T.submitOpensAt("2026-10-01").toISOString()).toBe("2026-10-19T19:00:00.000Z");
    expect(T.reviewDeadline("2026-10-01", 7).toISOString()).toBe("2026-11-07T18:59:59.999Z");
    expect(T.disputeDeadline("2026-10-01", 10).toISOString()).toBe("2026-11-10T18:59:59.999Z");
    expect(T.reminderFrom("2026-10-01", 7, 7).toISOString()).toBe("2026-10-30T19:00:00.000Z"); // 31 октября 00:00
  });
  it("день обрезается до длины месяца", () => {
    expect(T.dayEnd("2026-02-01", 31).toISOString()).toBe("2026-02-28T18:59:59.999Z");
  });
  it("currentReviewPeriod", () => {
    expect(T.currentReviewPeriod(new Date("2026-11-05T10:00:00Z"), 7)).toBe("2026-10-01");
    expect(T.currentReviewPeriod(new Date("2026-11-08T10:00:00Z"), 7)).toBe("2026-11-01");
  });
  it("кварталы", () => {
    expect(T.quarterStart("2026-11-01")).toBe("2026-10-01");
    expect(T.quarterStart("2026-03-01")).toBe("2026-01-01");
    expect(T.quarterMonths("2026-10-01")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(T.isQuarterStart("2026-07-01")).toBe(true);
    expect(T.isQuarterStart("2026-08-01")).toBe(false);
  });
  it("tashkentDay", () => {
    expect(T.tashkentDay(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11-01");
  });
});
