import { dayStartMs } from "./flags";

const HOUR = 3_600_000;
const MIN_SPAN = 6 * HOUR;

type Span = { open_at: string; close_at: string | null };

// Axis from the first opening to the last closing, whole hours, never outside
// 00:00 of the day .. 12:00 of the next day. Open shifts end at "now".
export function timelineAxis(
  shifts: Span[],
  day: string,
  nowMs: number
): { startMs: number; endMs: number; ticks: number[] } {
  const lo = dayStartMs(day);
  const hi = lo + 36 * HOUR;
  if (shifts.length === 0) return withTicks(lo + 8 * HOUR, lo + 24 * HOUR);
  const opens = shifts.map((s) => Date.parse(s.open_at));
  const closes = shifts.map((s) => (s.close_at ? Date.parse(s.close_at) : Math.min(nowMs, hi)));
  let start = Math.max(lo, Math.floor(Math.min(...opens) / HOUR) * HOUR);
  let end = Math.min(hi, Math.ceil(Math.max(...closes) / HOUR) * HOUR);
  if (end - start < MIN_SPAN) end = Math.min(hi, start + MIN_SPAN);
  if (end - start < MIN_SPAN) start = Math.max(lo, end - MIN_SPAN);
  return withTicks(start, end);
}

function withTicks(startMs: number, endMs: number) {
  const step = endMs - startMs > 24 * HOUR ? 3 * HOUR : 2 * HOUR;
  const ticks: number[] = [];
  for (let t = startMs; t <= endMs; t += step) ticks.push(t);
  return { startMs, endMs, ticks };
}

export function barGeometry(
  shift: Span,
  axis: { startMs: number; endMs: number },
  nowMs: number
): { leftPct: number; widthPct: number; openEnded: boolean } {
  const span = axis.endMs - axis.startMs;
  const clamp = (v: number) => Math.min(axis.endMs, Math.max(axis.startMs, v));
  const from = clamp(Date.parse(shift.open_at));
  const to = clamp(shift.close_at ? Date.parse(shift.close_at) : nowMs);
  return {
    leftPct: ((from - axis.startMs) / span) * 100,
    widthPct: Math.max(0, ((to - from) / span) * 100),
    openEnded: !shift.close_at,
  };
}
