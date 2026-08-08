// Deadline maths for the trainee passport.
//
// Lives in its own module rather than inside tg-controller.ts on purpose:
// tg-controller.ts imports @backend/context, which opens Postgres/Redis at
// import time. Keeping the pure function here lets tg-controller.test.ts unit
// test it with no database at all. `nowMs` is always a parameter — never
// Date.now() inside — so the boundary tests are deterministic.

export type DeadlineStatus = "ok" | "warning" | "overdue";

export const DEADLINE_WARNING_MS = 3 * 86400_000;

// Postgres `timestamptz` comes back from drizzle (mode: "string") as
// "2026-08-09 17:00:00+05", which is not ISO-8601. Date.parse handles it on
// JSC/V8 today, but the T-normalised retry keeps this honest if it ever stops.
export function parseTimestamp(value: string): number {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  return Date.parse(value.replace(" ", "T"));
}

export function deadlineStatus(
  startedAtIso: string,
  deadlineDays: number | null,
  nowMs: number
): { deadline_at: string | null; deadline_status: DeadlineStatus } {
  if (!deadlineDays) return { deadline_at: null, deadline_status: "ok" };
  const dl = parseTimestamp(startedAtIso) + deadlineDays * 86400_000;
  if (Number.isNaN(dl)) return { deadline_at: null, deadline_status: "ok" };
  const st: DeadlineStatus =
    nowMs > dl
      ? "overdue"
      : dl - nowMs <= DEADLINE_WARNING_MS
        ? "warning"
        : "ok";
  return { deadline_at: new Date(dl).toISOString(), deadline_status: st };
}
