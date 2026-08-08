import { describe, expect, it } from "bun:test";
import { deadlineStatus, parseTimestamp } from "./deadline";

const START = "2026-08-01T00:00:00.000Z";
const startMs = Date.parse(START);
const DAY = 86400_000;

describe("deadlineStatus", () => {
  it("returns ok while more than 3 days remain", () => {
    // deadline 10 days out, 3 days + 1ms of slack left
    const now = startMs + 10 * DAY - (3 * DAY + 1);
    expect(deadlineStatus(START, 10, now)).toEqual({
      deadline_at: new Date(startMs + 10 * DAY).toISOString(),
      deadline_status: "ok",
    });
  });

  it("returns warning at exactly 3 days remaining", () => {
    const now = startMs + 10 * DAY - 3 * DAY;
    expect(deadlineStatus(START, 10, now).deadline_status).toBe("warning");
  });

  it("returns overdue once the deadline has passed", () => {
    const dl = startMs + 10 * DAY;
    // exactly on the deadline is not yet overdue
    expect(deadlineStatus(START, 10, dl).deadline_status).toBe("warning");
    expect(deadlineStatus(START, 10, dl + 1).deadline_status).toBe("overdue");
  });

  it("has no deadline when deadline_days is null or zero", () => {
    expect(deadlineStatus(START, null, startMs + 999 * DAY)).toEqual({
      deadline_at: null,
      deadline_status: "ok",
    });
    expect(deadlineStatus(START, 0, startMs + 999 * DAY)).toEqual({
      deadline_at: null,
      deadline_status: "ok",
    });
  });

  it("parses the postgres timestamptz rendering", () => {
    expect(parseTimestamp("2026-08-01 05:00:00+05")).toBe(startMs);
    expect(deadlineStatus("2026-08-01 05:00:00+05", 1, startMs).deadline_at).toBe(
      new Date(startMs + DAY).toISOString()
    );
  });
});
