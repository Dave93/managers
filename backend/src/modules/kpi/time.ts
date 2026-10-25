// Периоды и сроки KPI. Asia/Tashkent = UTC+5 без перехода на летнее время.
export type Period = string; // "YYYY-MM-01"

const OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

// Строго YYYY-MM-01, месяц 01..12
export function isPeriod(s: unknown): s is Period {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-01$/.exec(s);
  if (!m) return false;
  const mon = Number(m[2]);
  return mon >= 1 && mon <= 12;
}

function parts(p: Period): { y: number; m: number } {
  return { y: Number(p.slice(0, 4)), m: Number(p.slice(5, 7)) };
}

function mk(y: number, m: number): Period {
  return `${y}-${pad(m)}-01`;
}

// Дата d, сдвинутая в «ташкентские» поля через UTC-геттеры
function shifted(d: Date): Date {
  return new Date(d.getTime() + OFFSET_MS);
}

export function periodOf(d: Date): Period {
  const s = shifted(d);
  return mk(s.getUTCFullYear(), s.getUTCMonth() + 1);
}

export function addMonths(p: Period, n: number): Period {
  const { y, m } = parts(p);
  const idx = y * 12 + (m - 1) + n;
  return mk(Math.floor(idx / 12), (((idx % 12) + 12) % 12) + 1);
}

export function tashkentDay(d: Date): string {
  const s = shifted(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

function daysInMonth(p: Period): number {
  const { y, m } = parts(p);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function clampDay(p: Period, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(p));
}

// 00:00 по Ташкенту, day обрезается до длины месяца
export function dayStart(p: Period, day: number): Date {
  const { y, m } = parts(p);
  return new Date(Date.UTC(y, m - 1, clampDay(p, day)) - OFFSET_MS);
}

// 23:59:59.999 по Ташкенту
export function dayEnd(p: Period, day: number): Date {
  return new Date(dayStart(p, day).getTime() + DAY_MS - 1);
}

export function submitOpensAt(p: Period): Date {
  return dayStart(p, 20);
}

export function reviewDeadline(p: Period, reviewDay: number): Date {
  return dayEnd(addMonths(p, 1), reviewDay);
}

export function disputeDeadline(p: Period, disputeDay: number): Date {
  return dayEnd(addMonths(p, 1), disputeDay);
}

// 00:00 дня, который на daysBefore дней раньше даты срока проверки
export function reminderFrom(p: Period, reviewDay: number, daysBefore: number): Date {
  const next = addMonths(p, 1);
  return new Date(dayStart(next, reviewDay).getTime() - daysBefore * DAY_MS);
}

// Прошлый месяц, пока не прошёл его срок проверки, иначе текущий
export function currentReviewPeriod(now: Date, reviewDay: number): Period {
  const cur = periodOf(now);
  const prev = addMonths(cur, -1);
  return now.getTime() <= reviewDeadline(prev, reviewDay).getTime() ? prev : cur;
}

export function quarterStart(p: Period): Period {
  const { y, m } = parts(p);
  return mk(y, Math.floor((m - 1) / 3) * 3 + 1);
}

export function quarterMonths(q: Period): [Period, Period, Period] {
  return [q, addMonths(q, 1), addMonths(q, 2)];
}

export function isQuarterStart(s: unknown): s is Period {
  return isPeriod(s) && (parts(s).m - 1) % 3 === 0;
}
