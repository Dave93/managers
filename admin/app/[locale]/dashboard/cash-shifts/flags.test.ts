/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { computeFlags, DEFAULT_SHIFT_SETTINGS, hhmmToMinutes, tashkentToday } from "./flags";
import { barGeometry, timelineAxis } from "./timeline";

const TODAY = "2026-09-10";
let n = 0;
const shift = (terminal: string | null, day: string, open: string, close: string | null, group: string | null = null) => ({
  id: `s${++n}`,
  terminal_id: terminal,
  iiko_group_id: group,
  business_date: day,
  open_at: `${open}+05:00`,
  close_at: close ? `${close}+05:00` : null,
});
const flagsOf = (shifts: ReturnType<typeof shift>[], settings = DEFAULT_SHIFT_SETTINGS) => {
  const { visible, hiddenCount } = computeFlags(shifts, settings, TODAY);
  return { byId: Object.fromEntries(visible.map((s) => [s.id, s.flags])), hiddenCount };
};

describe("computeFlags", () => {
  test("24h branch: shifts at 01:31 and 17:59 are not late", () => {
    // 01:31 → 17:00 is 15.5 h; the real 01:31 → 17:59 shift is 16.5 h and is
    // rightly flagged too_long by the default 16 h threshold.
    const a1 = shift("A", "2026-09-09", "2026-09-09T01:31:56", "2026-09-09T17:00:00");
    const a2 = shift("A", "2026-09-09", "2026-09-09T17:59:10", "2026-09-10T03:09:00");
    const { byId } = flagsOf([a1, a2]);
    expect(byId[a1.id]).toEqual([]);
    expect(byId[a2.id]).toEqual([]);
  });
  test("night shift after a day shift is not a late opening", () => {
    const b1 = shift("B", "2026-09-09", "2026-09-09T09:01:17", "2026-09-09T18:15:30");
    const b2 = shift("B", "2026-09-09", "2026-09-09T18:44:00", "2026-09-10T03:12:00");
    expect(flagsOf([b1, b2]).byId[b2.id]).toEqual([]);
  });
  test("first shift after 10:30 is a late opening", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1]).byId[c1.id]).toEqual(["late_open"]);
  });
  test("closing at 10:19 next day is a late close but not a long shift when it started at 19:02", () => {
    const d1 = shift("D", "2026-09-09", "2026-09-09T19:02:00", "2026-09-10T10:19:56");
    const d0 = shift("D", "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T18:57:00");
    expect(flagsOf([d0, d1]).byId[d1.id]).toEqual(["late_close"]);
  });
  test("24h shift is both a late close and a long shift", () => {
    const e1 = shift("E", "2026-09-09", "2026-09-09T09:47:00", "2026-09-10T09:45:00");
    expect(flagsOf([e1]).byId[e1.id]).toEqual(["late_close", "too_long"]);
  });
  test("open shift of a past day is unclosed, of today it is fine", () => {
    const f1 = shift("F", "2026-09-08", "2026-09-08T09:00:00", null);
    const f2 = shift("G", TODAY, `${TODAY}T09:00:00`, null);
    const { byId } = flagsOf([f1, f2]);
    expect(byId[f1.id]).toEqual(["unclosed"]);
    expect(byId[f2.id]).toEqual([]);
  });
  test("empty shifts are hidden and do not count as the first shift of the day", () => {
    const h0 = shift("H", "2026-09-09", "2026-09-09T08:00:00", "2026-09-09T08:00:22");
    const h1 = shift("H", "2026-09-09", "2026-09-09T11:00:00", "2026-09-09T20:00:00");
    const { byId, hiddenCount } = flagsOf([h0, h1]);
    expect(hiddenCount).toBe(1);
    expect(byId[h0.id]).toBeUndefined();
    expect(byId[h1.id]).toEqual(["late_open"]);
  });
  test("second register of the same terminal opening at 12:00 is not late", () => {
    const i1 = shift("I", "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T20:00:00");
    const i2 = shift("I", "2026-09-09", "2026-09-09T12:00:00", "2026-09-09T20:00:00");
    expect(flagsOf([i1, i2]).byId[i2.id]).toEqual([]);
  });
  test("unmapped registers are grouped by iiko group", () => {
    const j1 = shift(null, "2026-09-09", "2026-09-09T09:00:00", "2026-09-09T20:00:00", "g1");
    const j2 = shift(null, "2026-09-09", "2026-09-09T12:00:00", "2026-09-09T20:00:00", "g1");
    expect(flagsOf([j1, j2]).byId[j2.id]).toEqual([]);
  });
  test("thresholds come from settings", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1], { ...DEFAULT_SHIFT_SETTINGS, lateOpenAfter: "11:30" }).byId[c1.id]).toEqual([]);
  });
  test("a broken threshold string disables that rule instead of flagging everything", () => {
    const c1 = shift("C", "2026-09-09", "2026-09-09T11:20:00", "2026-09-09T18:57:00");
    expect(flagsOf([c1], { ...DEFAULT_SHIFT_SETTINGS, lateOpenAfter: "" }).byId[c1.id]).toEqual([]);
  });
});

describe("time helpers", () => {
  test("hhmmToMinutes", () => {
    expect(hhmmToMinutes("10:30")).toBe(630);
    expect(Number.isNaN(hhmmToMinutes("25:00"))).toBe(true);
    expect(Number.isNaN(hhmmToMinutes("abc"))).toBe(true);
  });
  test("tashkentToday", () => {
    expect(tashkentToday(new Date("2026-09-09T19:30:00Z"))).toBe("2026-09-10");
  });
});

describe("timeline", () => {
  const H = 3_600_000;
  const dayStart = Date.parse("2026-09-09T00:00:00+05:00");
  test("axis spans first open to last close rounded to hours", () => {
    const axis = timelineAxis(
      [
        { open_at: "2026-09-09T08:59:34+05:00", close_at: "2026-09-09T21:19:14+05:00" },
        { open_at: "2026-09-09T18:44:00+05:00", close_at: "2026-09-10T03:12:00+05:00" },
      ],
      "2026-09-09",
      dayStart + 48 * H
    );
    expect(axis.startMs).toBe(dayStart + 8 * H);
    expect(axis.endMs).toBe(dayStart + 28 * H);
    expect(axis.ticks[0]).toBe(dayStart + 8 * H);
  });
  test("axis is clamped to 00:00 D .. 12:00 D+1", () => {
    const axis = timelineAxis(
      [{ open_at: "2026-09-08T22:00:00+05:00", close_at: "2026-09-10T20:00:00+05:00" }],
      "2026-09-09",
      dayStart + 72 * H
    );
    expect(axis.startMs).toBe(dayStart);
    expect(axis.endMs).toBe(dayStart + 36 * H);
  });
  test("empty day gets a 08:00-24:00 axis", () => {
    const axis = timelineAxis([], "2026-09-09", dayStart + 48 * H);
    expect(axis.startMs).toBe(dayStart + 8 * H);
    expect(axis.endMs).toBe(dayStart + 24 * H);
  });
  test("bar geometry, open-ended bar stops at now", () => {
    const axis = { startMs: dayStart + 8 * H, endMs: dayStart + 24 * H };
    expect(barGeometry({ open_at: "2026-09-09T12:00:00+05:00", close_at: "2026-09-09T16:00:00+05:00" }, axis, dayStart + 48 * H)).toEqual({ leftPct: 25, widthPct: 25, openEnded: false });
    expect(barGeometry({ open_at: "2026-09-09T12:00:00+05:00", close_at: null }, axis, dayStart + 20 * H)).toEqual({ leftPct: 25, widthPct: 50, openEnded: true });
  });
});
