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

/** Периоды, доступные для новой инвентаризации: текущий месяц и прошлый, без срока ввода. */
export function allowedPeriods(now: Date): string[] {
  const { y, m } = tashkentParts(now);
  return [lastDayOfMonth(y, m), previousPeriod(now)];
}

/** Последний день прошлого месяца по Ташкенту — период, который сверяет cron. */
export function previousPeriod(now: Date): string {
  const { y, m } = tashkentParts(now);
  const p = prevMonth(y, m);
  return lastDayOfMonth(p.y, p.m);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Последний день месяца даты YYYY-MM-DD — период промежуточного пересчёта. */
export function lastDayOf(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return lastDayOfMonth(y, m);
}

/** Даты промежуточного пересчёта (spec 2026-10-08, решение 2): только прошедший день,
 * с 1-го числа прошлого месяца по вчера (Ташкент); по умолчанию — вчера. */
export function interimDates(now: Date): { min: string; max: string; default: string } {
  const { y, m, d } = tashkentParts(now);
  const yesterday = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
  const p = prevMonth(y, m);
  return { min: `${p.y}-${pad(p.m)}-01`, max: yesterday, default: yesterday };
}

export function isValidInterimDate(date: string, now: Date): boolean {
  if (!isValidDate(date)) return false;
  const { min, max } = interimDates(now);
  return date >= min && date <= max;
}

export const MAX_QTY = 1_000_000;

export function isValidQty(q: unknown): q is number {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (q < 0 || q > MAX_QTY) return false;
  return Number(q.toFixed(4)) === q;
}
