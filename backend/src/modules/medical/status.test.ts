import { describe, expect, it } from "bun:test";
import {
  addMonthsClamped,
  computeStatus,
  daysUntil,
  projectFutureDates,
} from "./status";

describe("addMonthsClamped", () => {
  it("adds months normally", () => {
    expect(addMonthsClamped("2026-07-16", 6)).toBe("2027-01-16");
  });
  it("clamps to end of shorter month", () => {
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("handles leap february", () => {
    expect(addMonthsClamped("2027-08-31", 6)).toBe("2028-02-29");
  });
  it("crosses year boundary", () => {
    expect(addMonthsClamped("2026-12-15", 2)).toBe("2027-02-15");
  });
});

describe("daysUntil", () => {
  it("positive for future, negative for past, zero today", () => {
    expect(daysUntil("2026-07-20", "2026-07-16")).toBe(4);
    expect(daysUntil("2026-07-10", "2026-07-16")).toBe(-6);
    expect(daysUntil("2026-07-16", "2026-07-16")).toBe(0);
  });
});

describe("computeStatus", () => {
  const today = "2026-07-16";
  it("unfit wins regardless of dates", () => {
    expect(
      computeStatus({ lastResult: "unfit", openDueDate: "2027-01-01", todayIso: today })
    ).toBe("unfit");
  });
  it("none when no open due date", () => {
    expect(computeStatus({ lastResult: null, openDueDate: null, todayIso: today })).toBe("none");
  });
  it("overdue when due before today", () => {
    expect(
      computeStatus({ lastResult: "fit", openDueDate: "2026-07-15", todayIso: today })
    ).toBe("overdue");
  });
  it("due_soon on boundary days 0 and DUE_SOON_DAYS", () => {
    expect(
      computeStatus({ lastResult: null, openDueDate: today, todayIso: today })
    ).toBe("due_soon");
    expect(
      computeStatus({ lastResult: null, openDueDate: "2026-08-15", todayIso: today })
    ).toBe("due_soon"); // exactly 30 days
  });
  it("ok beyond the window", () => {
    expect(
      computeStatus({ lastResult: null, openDueDate: "2026-08-16", todayIso: today })
    ).toBe("ok"); // 31 days
  });
});

describe("projectFutureDates", () => {
  it("6-month interval over 5 years yields 10 dates, excludes start", () => {
    const dates = projectFutureDates("2026-07-16", 6);
    expect(dates.length).toBe(10);
    expect(dates[0]).toBe("2027-01-16");
    expect(dates[9]).toBe("2031-07-16");
  });
  it("12-month interval over 5 years yields 5 dates", () => {
    expect(projectFutureDates("2026-01-01", 12).length).toBe(5);
  });
});
