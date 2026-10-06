// Единственное место, где записаны жизненный цикл инвентаризации и
// календарные правила. Контроллер и фронт спрашивают здесь, а не держат
// свои копии условий.

export type CountStatus = "draft" | "submitted" | "cancelled";
export type CountAction = "submit" | "reopen" | "cancel";

const TRANSITIONS: Record<CountAction, { from: CountStatus[]; to: CountStatus }> = {
  submit: { from: ["draft"], to: "submitted" },
  reopen: { from: ["submitted"], to: "draft" },
  cancel: { from: ["draft"], to: "cancelled" },
};

export function nextStatus(action: CountAction, from: string): CountStatus | null {
  const rule = TRANSITIONS[action];
  if (!rule) return null;
  return (rule.from as string[]).includes(from) ? rule.to : null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Asia/Tashkent — UTC+5 круглый год, без перехода на летнее время, поэтому
// хватает сдвига, без Intl и без зависимости от TZ сервера.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

function tashkentParts(now: Date): { y: number; m: number; d: number } {
  const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

function prevMonth(y: number, m: number): { y: number; m: number } {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

function nextMonth(y: number, m: number): { y: number; m: number } {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

export function isValidPeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  return lastDayOfMonth(year, month) === period;
}

// Срок ввода (spec 2026-10-06, §8): 2-е число следующего месяца, 12:00 по Ташкенту.
export const DEADLINE_DAY = 2;
export const DEADLINE_HOUR_TASHKENT = 12;
export const UNLOCK_HOURS = 24;

export function inputDeadline(period: string): Date {
  const [py, pm] = period.split("-").map(Number);
  const n = nextMonth(py, pm);
  return new Date(Date.UTC(n.y, n.m - 1, DEADLINE_DAY, DEADLINE_HOUR_TASHKENT) - TASHKENT_OFFSET_MS);
}

/** Филиал может менять пересчёт: до срока или пока действует разблокировка офиса. */
export function isInputOpen(period: string, unlockedUntil: string | null, now: Date): boolean {
  if (!isValidPeriod(period)) return false;
  if (now.getTime() < inputDeadline(period).getTime()) return true;
  return unlockedUntil !== null && Date.parse(unlockedUntil) > now.getTime();
}

/** Периоды, доступные для новой инвентаризации. Первый — текущий месяц, прошлый — до его срока ввода. */
export function allowedPeriods(now: Date): string[] {
  const { y, m } = tashkentParts(now);
  const current = lastDayOfMonth(y, m);
  const prev = previousPeriod(now);
  return now.getTime() < inputDeadline(prev).getTime() ? [current, prev] : [current];
}

/** Последний день прошлого месяца по Ташкенту — период, который сверяет cron. */
export function previousPeriod(now: Date): string {
  const { y, m } = tashkentParts(now);
  const p = prevMonth(y, m);
  return lastDayOfMonth(p.y, p.m);
}

export const MAX_QTY = 1_000_000;

export function isValidQty(q: unknown): q is number {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (q < 0 || q > MAX_QTY) return false;
  return Number(q.toFixed(4)) === q;
}
