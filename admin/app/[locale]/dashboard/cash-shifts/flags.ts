// Violation rules for the cash shift widget. Pure: no React, no fetch, so the
// thresholds can be tested and changed without touching the UI.
// All wall-clock rules are in Tashkent time (UTC+5, no DST).

export type ShiftSettings = {
  lateOpenAfter: string; // "HH:MM", first shift of a location opened later is late
  lateCloseAfter: string; // "HH:MM" of the NEXT day
  maxDurationHours: number;
  hideShorterThanMin: number;
};

export const DEFAULT_SHIFT_SETTINGS: ShiftSettings = {
  lateOpenAfter: "10:30",
  lateCloseAfter: "05:00",
  maxDurationHours: 16,
  hideShorterThanMin: 5,
};

export type ShiftFlag = "late_open" | "late_close" | "too_long" | "unclosed";

export type FlaggableShift = {
  id: string;
  terminal_id: string | null;
  iiko_group_id: string | null;
  business_date: string;
  open_at: string;
  close_at: string | null;
};

const MIN_MS = 60_000;
const DAY_MIN = 1440;

export function hhmmToMinutes(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? "");
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : NaN;
}

export function tashkentToday(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export function dayStartMs(businessDate: string): number {
  return Date.parse(`${businessDate}T00:00:00+05:00`);
}

const durationMin = (s: FlaggableShift) =>
  s.close_at ? (Date.parse(s.close_at) - Date.parse(s.open_at)) / MIN_MS : null;

// A location is a terminal; an unmapped register falls back to its iiko group,
// and failing that stands on its own.
const locationKey = (s: FlaggableShift) =>
  `${s.terminal_id ?? `group:${s.iiko_group_id ?? s.id}`}|${s.business_date}`;

export function computeFlags<T extends FlaggableShift>(
  shifts: T[],
  settings: ShiftSettings,
  today: string
): { visible: (T & { flags: ShiftFlag[] })[]; hiddenCount: number } {
  const lateOpen = hhmmToMinutes(settings.lateOpenAfter);
  const lateClose = hhmmToMinutes(settings.lateCloseAfter);
  const maxMin = settings.maxDurationHours * 60;

  const visible: T[] = [];
  let hiddenCount = 0;
  for (const s of shifts) {
    const d = durationMin(s);
    if (d !== null && d < settings.hideShorterThanMin) hiddenCount++;
    else visible.push(s);
  }

  const first = new Map<string, T>();
  for (const s of visible) {
    const key = locationKey(s);
    const cur = first.get(key);
    if (!cur || Date.parse(s.open_at) < Date.parse(cur.open_at)) first.set(key, s);
  }
  const firstIds = new Set([...first.values()].map((s) => s.id));

  return {
    hiddenCount,
    visible: visible.map((s) => {
      const flags: ShiftFlag[] = [];
      const start = dayStartMs(s.business_date);
      if (
        firstIds.has(s.id) &&
        Number.isFinite(lateOpen) &&
        (Date.parse(s.open_at) - start) / MIN_MS > lateOpen
      ) {
        flags.push("late_open");
      }
      if (s.close_at) {
        if (Number.isFinite(lateClose) && (Date.parse(s.close_at) - start) / MIN_MS > DAY_MIN + lateClose) {
          flags.push("late_close");
        }
        if (Number.isFinite(maxMin) && durationMin(s)! > maxMin) flags.push("too_long");
      } else if (s.business_date < today) {
        flags.push("unclosed");
      }
      return { ...s, flags };
    }),
  };
}
