import { describe, expect, it } from "bun:test";
import { monthOf, neighbours } from "./attendance-rules";

describe("kpi tg-app: правила месяца посещаемости", () => {
  it("monthOf: только YYYY-MM с месяцем 01..12", () => {
    expect(monthOf("2026-11")).toBe("2026-11");
    expect(monthOf("2026-12")).toBe("2026-12");
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", " 2026-11", "abc", "0000-01", "0001-01", "0050-06", "2026-11\n", "٢٠٢٦-١١", null, undefined, 202611, ["2026-11"]]) {
      expect(monthOf(bad)).toBeNull();
    }
  });

  it("neighbours: ближайшие месяцы со строками, текущий достижим всегда", () => {
    const data = ["2026-06", "2026-08"];
    expect(neighbours(data, "2026-11", "2026-11")).toEqual({ prev: "2026-08", next: null });
    expect(neighbours(data, "2026-07", "2026-11")).toEqual({ prev: "2026-06", next: "2026-08" });
    expect(neighbours(data, "2026-08", "2026-11")).toEqual({ prev: "2026-06", next: "2026-11" });
    expect(neighbours(data, "2026-06", "2026-11")).toEqual({ prev: null, next: "2026-08" });
    expect(neighbours(data, "2027-03", "2026-11")).toEqual({ prev: "2026-11", next: null });
  });

  it("neighbours: нет данных, порядок и дубликаты на входе не важны", () => {
    expect(neighbours([], "2026-11", "2026-11")).toEqual({ prev: null, next: null });
    expect(neighbours(["2026-11"], "2026-11", "2026-11")).toEqual({ prev: null, next: null });
    expect(neighbours(["2026-08", "2026-06", "2026-08"], "2026-07", "2026-11")).toEqual({ prev: "2026-06", next: "2026-08" });
  });
});
