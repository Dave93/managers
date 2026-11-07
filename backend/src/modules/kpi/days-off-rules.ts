// Правила выходных дней без БД: список причин, разбор дат диапазона и причины. Проверяются до записи.
// Все даты — календарные строки YYYY-MM-01..31 по Ташкенту; Date только в UTC, пояс хоста не участвует.
import { KpiError } from "./errors";
import { commentOk } from "./rules";
import type { DayOffReason } from "./tg-app/ev-types";

export const DAY_OFF_REASONS: readonly DayOffReason[] = ["sick", "family", "time_off", "vacation", "schedule", "other"];
// Дней в одном запросе; вперёд от сегодня; назад от сегодня (защита от мусорных дат, закрытые месяцы режет сервис).
export const MAX_RANGE_DAYS = 31;
export const MAX_AHEAD_DAYS = 31;
export const MAX_BACK_DAYS = 366;
// Мягкий лимит выходных одного сотрудника в календарном месяце (все причины, все авторы). Не запрет: форма лишь
// предупреждает, что выдаётся больше, а сервер записывает выходной в любом случае (решение владельца 2026-11-07).
export const DAYS_OFF_MONTH_LIMIT = 4;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");
const badDates = () => new KpiError(422, "bad_dates");

// Сдвиг календарной даты на n дней.
export function addDays(day: string, n: number): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error("days-off: неверная дата");
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Настоящая календарная дата YYYY-MM-DD (не 2026-02-30).
function isDay(s: unknown): s is string {
  return typeof s === "string" && DAY_RE.test(s) && addDays(s, 0) === s;
}

// Первое число месяца дня: "2026-11-17" → "2026-11-01".
export function periodOfDay(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/**
 * Дни от from до to включительно по возрастанию. 422 bad_dates: не дата, from > to, больше 31 дня,
 * to позже today + 31, from раньше today − 366. today — сегодняшний день по Ташкенту.
 */
export function expandRange(from: unknown, to: unknown, today: string): string[] {
  if (!isDay(from) || !isDay(to) || from > to) throw badDates();
  if (to > addDays(today, MAX_AHEAD_DAYS) || from < addDays(today, -MAX_BACK_DAYS)) throw badDates();
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (days.length === MAX_RANGE_DAYS) throw badDates();
    days.push(d);
  }
  return days;
}

/**
 * Причина выходного. 422 bad_reason: не строка или не из списка; 422 reason_text_required: «другая» без
 * текста от 3 букв или цифр. У остальных причин текст не хранится.
 */
export function checkReason(code: unknown, text: unknown): { reason_code: DayOffReason; reason_text: string | null } {
  if (typeof code !== "string" || !(DAY_OFF_REASONS as readonly string[]).includes(code)) throw new KpiError(422, "bad_reason");
  const reason_code = code as DayOffReason;
  if (reason_code !== "other") return { reason_code, reason_text: null };
  if (!commentOk(text, 3)) throw new KpiError(422, "reason_text_required");
  return { reason_code, reason_text: (text as string).trim() };
}
