import { describe, expect, it } from "bun:test";
import * as P from "./periods";

describe("месяцы по Ташкенту", () => {
  it("calendarPeriod", () => {
    expect(P.calendarPeriod(new Date("2026-10-31T19:30:00Z"))).toBe("2026-11-01");
    expect(P.calendarPeriod(new Date("2026-10-31T18:59:59Z"))).toBe("2026-10-01");
  });
  it("addMonths и periodOptions", () => {
    expect(P.addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(P.addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(P.periodOptions(new Date("2026-11-05T10:00:00Z"), 3)).toEqual(["2026-11-01", "2026-10-01", "2026-09-01"]);
    expect(P.periodOptions(new Date("2026-01-15T10:00:00Z"), 2)).toEqual(["2026-01-01", "2025-12-01"]);
  });
  it("monthLabel без «г.»", () => expect(P.monthLabel("2026-10-01")).toBe("октябрь 2026"));
  it("submitOpen", () => {
    const d = { submit_opens_at: "2026-10-19T19:00:00.000Z" };
    expect(P.submitOpen(new Date("2026-10-19T18:59:59Z"), d)).toBe(false);
    expect(P.submitOpen(new Date("2026-10-19T19:00:00Z"), d)).toBe(true);
  });
});

describe("кварталы", () => {
  it("quarterOf для всех четырёх", () => {
    expect(P.quarterOf("2026-02-01")).toBe("2026-01-01");
    expect(P.quarterOf("2026-05-01")).toBe("2026-04-01");
    expect(P.quarterOf("2026-08-01")).toBe("2026-07-01");
    expect(P.quarterOf("2026-12-01")).toBe("2026-10-01");
  });
  it("quarterOptions и defaultQuarter", () => {
    expect(P.quarterOptions(new Date("2026-11-05T10:00:00Z"), 3)).toEqual(["2026-10-01", "2026-07-01", "2026-04-01"]);
    expect(P.quarterOptions(new Date("2026-02-01T10:00:00Z"), 2)).toEqual(["2026-01-01", "2025-10-01"]);
    expect(P.defaultQuarter(new Date("2026-10-25T10:00:00Z"))).toBe("2026-07-01");
    expect(P.defaultQuarter(new Date("2026-12-31T10:00:00Z"))).toBe("2026-07-01");
    expect(P.defaultQuarter(new Date("2027-01-02T10:00:00Z"))).toBe("2026-10-01");
  });
  it("подписи, месяцы, имя CSV", () => {
    expect(P.quarterLabel("2026-01-01")).toBe("I квартал 2026");
    expect(P.quarterLabel("2026-10-01")).toBe("IV квартал 2026");
    expect(P.quarterMonths("2026-10-01")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"].map(P.raisesCsvFilename)).toEqual([
      "kpi-raises-2026-Q1.csv", "kpi-raises-2026-Q2.csv", "kpi-raises-2026-Q3.csv", "kpi-raises-2026-Q4.csv",
    ]);
  });
});
