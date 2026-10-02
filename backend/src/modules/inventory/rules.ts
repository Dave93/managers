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
export const PERIOD_GRACE_DAYS = 5;

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

/** Периоды, доступные для новой инвентаризации. Первый — текущий месяц. */
export function allowedPeriods(now: Date): string[] {
  const { y, m, d } = tashkentParts(now);
  const current = lastDayOfMonth(y, m);
  if (d > PERIOD_GRACE_DAYS) return [current];
  const p = prevMonth(y, m);
  return [current, lastDayOfMonth(p.y, p.m)];
}

export function isValidPeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  return lastDayOfMonth(year, month) === period;
}

/** Вернуть в черновик можно до PERIOD_GRACE_DAYS числа следующего месяца включительно. */
export function canReopen(period: string, now: Date): boolean {
  if (!isValidPeriod(period)) return false;
  const [py, pm] = period.split("-").map(Number);
  const limit = nextMonth(py, pm);
  const { y, m, d } = tashkentParts(now);
  const nowKey = y * 10000 + m * 100 + d;
  const limitKey = limit.y * 10000 + limit.m * 100 + PERIOD_GRACE_DAYS;
  return nowKey <= limitKey;
}

export const MAX_QTY = 1_000_000;

export function isValidQty(q: unknown): q is number {
  if (typeof q !== "number" || !Number.isFinite(q)) return false;
  if (q < 0 || q > MAX_QTY) return false;
  return Number(q.toFixed(4)) === q;
}
