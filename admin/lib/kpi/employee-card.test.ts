import { describe, expect, it } from "bun:test";
import { attendanceDays, daysInPeriod, hhmm, lostItems, pickTitle, reachedTier } from "./employee-card";

describe("карточка: посещаемость", () => {
  it("время по Ташкенту", () => {
    expect(hhmm("2026-10-02T01:05:00+00:00")).toBe("06:05");
    expect(hhmm("2026-10-02T21:30:00Z")).toBe("02:30");
    expect(hhmm(null)).toBeNull();
    expect(hhmm("мусор")).toBeNull();
  });
  it("дни: вовремя, опоздание с временем, прогул, пустые", () => {
    const days = attendanceDays(31, {
      days: [
        { day: "2026-10-30", check_in: null, check_out: null, late_minutes: 0, absent: true },
        { day: "2026-10-02", check_in: "2026-10-02T01:05:00+00:00", check_out: "2026-10-02T09:00:00+00:00", late_minutes: 65, absent: false },
        { day: "2026-10-01", check_in: null, check_out: null, late_minutes: 0, absent: false },
      ],
    });
    expect(days).toHaveLength(31);
    expect(days[0]).toEqual([0, 0, null, null]);
    expect(days[1]).toEqual([1, 65, "06:05", "14:00"]);
    expect(days[2]).toBeNull();
    expect(days[29]).toEqual([2, 0, null, null]);
  });
  it("число дней месяца", () => {
    expect(daysInPeriod("2026-10-01")).toBe(31);
    expect(daysInPeriod("2026-02-01")).toBe(28);
    expect(daysInPeriod("2028-02-01")).toBe(29);
  });
});

describe("карточка: ступени прибавки", () => {
  const tiers = [
    { min_pct: 80, amount: 100_000 },
    { min_pct: 90, amount: 300_000 },
  ];
  it("достигнутая ступень", () => {
    expect(reachedTier(79.9, tiers)).toBeNull();
    expect(reachedTier(80, tiers)).toEqual(tiers[0]);
    expect(reachedTier(95, tiers)).toEqual(tiers[1]);
    expect(reachedTier(null, tiers)).toBeNull();
  });
});

describe("карточка: потери и названия", () => {
  it("потери: ниже 100, худшие первыми, равные по порядку карты, не больше трёх", () => {
    const items = [
      { id: "a", score: 100 },
      { id: "b", score: 60 },
      { id: "c", score: null },
      { id: "d", score: 60 },
      { id: "e", score: 20 },
      { id: "f", score: 90 },
    ];
    expect(lostItems(items).map((x) => x.id)).toEqual(["e", "b", "d"]);
    expect(lostItems([{ score: 100 }, { score: null }])).toEqual([]);
  });
  it("название: узбекское на узбекских локалях, иначе русское", () => {
    expect(pickTitle("ru", "Чистота", "Tozalik")).toBe("Чистота");
    expect(pickTitle("uz-Latn", "Чистота", "Tozalik")).toBe("Tozalik");
    expect(pickTitle("uz-Cyrl", "Чистота", " ")).toBe("Чистота");
    expect(pickTitle("en", null, null)).toBe("");
  });
});
