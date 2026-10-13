import { describe, expect, test } from "bun:test";
import { formatDay, periodLabel, recentPeriods } from "./periods";

describe("recentPeriods", () => {
  test("последние n периодов по Ташкенту, текущий первым", () => {
    expect(recentPeriods(new Date("2026-10-31T22:00:00Z"), 3)).toEqual(["2026-11-30", "2026-10-31", "2026-09-30"]);
    expect(recentPeriods(new Date("2026-01-15T10:00:00Z"), 2)).toEqual(["2026-01-31", "2025-12-31"]);
  });
});

describe("periodLabel", () => {
  test("месяц и год по локали", () => {
    expect(periodLabel("2026-10-31", "ru").toLowerCase()).toContain("2026");
    expect(periodLabel("2026-10-31", "ru").toLowerCase()).toContain("октябр");
  });
});

describe("formatDay", () => {
  test("YYYY-MM-DD → ДД.ММ.ГГГГ", () => {
    expect(formatDay("2026-10-07")).toBe("07.10.2026");
    expect(formatDay("garbage")).toBe("garbage");
  });
});
