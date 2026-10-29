import { describe, expect, it } from "bun:test";
import { iso } from "./iso";

describe("kpi/iso", () => {
  it("текст timestamptz из Postgres и Date → ISO UTC; null остаётся null", () => {
    expect(iso("2025-08-25 05:00:00+00")).toBe("2025-08-25T05:00:00.000Z");
    expect(iso("2025-08-25 10:00:00.123456+05")).toBe("2025-08-25T05:00:00.123Z");
    expect(iso("2025-08-25 10:00:00+05:30")).toBe("2025-08-25T04:30:00.000Z");
    expect(iso("2025-08-25T05:00:00.000Z")).toBe("2025-08-25T05:00:00.000Z");
    expect(iso(new Date(Date.UTC(2025, 7, 25, 5)))).toBe("2025-08-25T05:00:00.000Z");
    expect(iso(null)).toBeNull();
  });

  it("не время — исключение, а не строка Invalid Date", () => {
    expect(() => iso("вчера")).toThrow();
  });
});
