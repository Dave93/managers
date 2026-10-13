import { describe, expect, test } from "bun:test";
import { normalizeDates } from "./normalize";

describe("normalizeDates", () => {
  test("Date в полночь UTC становится YYYY-MM-DD (период), иначе ISO-строкой", () => {
    const input = {
      periods: [new Date("2026-10-31"), new Date("2026-09-30")],
      count: { period: new Date("2026-10-31"), created_at: new Date("2026-10-02T12:05:42.123Z"), name: "Говядина" },
      lines: [{ total: "5.5", entries: [{ client_created_at: new Date("2026-10-02T10:00:00.500Z") }] }],
      empty: null,
    };
    expect(normalizeDates(input) as unknown).toEqual({
      periods: ["2026-10-31", "2026-09-30"],
      count: { period: "2026-10-31", created_at: "2026-10-02T12:05:42.123Z", name: "Говядина" },
      lines: [{ total: "5.5", entries: [{ client_created_at: "2026-10-02T10:00:00.500Z" }] }],
      empty: null,
    });
  });
  test("примитивы не трогает", () => {
    expect(normalizeDates("2026-10-31")).toBe("2026-10-31");
    expect(normalizeDates(5)).toBe(5);
    expect(normalizeDates(undefined)).toBeUndefined();
  });
});
