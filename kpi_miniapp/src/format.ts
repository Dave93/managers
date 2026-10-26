// Форматы чисел, дат и шкалы (без DOM). Дата и время — по Ташкенту (+5 фиксированно).
import type { Lang } from "./i18n";
import { monthName } from "./i18n";

const NBSP = " ";
const TASHKENT_MS = 5 * 3600 * 1000;

/** Половина вверх до 0,1 через toPrecision(12), как round2 на backend (без шума двоичной дроби). */
function ratio10(n: number): number {
  return +(n * 10).toPrecision(12);
}

/**
 * Процент с одной цифрой после запятой, без знака «%». Если для порога из
 * guard выполнено n < t, а округление дотянулось до t, берём округление вниз:
 * 89,96 → «89,9», а не «90,0» рядом с суммой предыдущей ступени.
 */
export function pct1(n: number, guard: number[] = []): string {
  let tenths = Math.round(ratio10(n));
  if (guard.some((t) => n < t && tenths / 10 >= t)) tenths = Math.floor(ratio10(n));
  return (tenths / 10).toFixed(1).replace(".", ",");
}

/** Сумма с группами тысяч через U+00A0: «300 000». */
export function sum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Одна десятичная через запятую, «,0» отбрасывается: 150,5 / 150. */
function short1(x: number): string {
  return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

/** Подпись шкалы: «150 тыс» / «150 ming», от миллиона «1,5 млн» / «1,5 mln». */
export function sumShort(n: number, l: Lang): string {
  if (n >= 1_000_000) return `${short1(n / 1_000_000)}${NBSP}${l === "ru" ? "млн" : "mln"}`;
  if (n >= 1000) return `${short1(n / 1000)}${NBSP}${l === "ru" ? "тыс" : "ming"}`;
  return String(Math.round(n));
}

/** Календарные части момента по Ташкенту: UTC-геттеры от сдвинутой даты. */
function tashkent(isoOrMs: string | number): Date {
  return new Date(new Date(isoOrMs).getTime() + TASHKENT_MS);
}

/** «10 ноября» / «10-noyabr». */
export function dayMonth(iso: string, l: Lang): string {
  const d = tashkent(iso);
  const month = monthName(`2000-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`, "gen", l);
  return l === "ru" ? `${d.getUTCDate()} ${month}` : `${d.getUTCDate()}-${month}`;
}

/** «20.12». */
export function ddmm(iso: string): string {
  const d = tashkent(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** «14:02». */
export function hhmm(ms: number): string {
  const d = tashkent(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Инициалы: первые буквы имени и фамилии заглавными. */
export function initials(first: string, last: string): string {
  const letter = (s: string) => (Array.from(s.trim())[0] ?? "").toUpperCase();
  return letter(first) + letter(last);
}

/**
 * Позиция среднего на шкале 0..1. n ступеней делят шкалу на n + 1 равных
 * отрезков: нулевой — [mins[0] − 10, mins[0]), k-й — [mins[k−1], mins[k]),
 * последний — [mins[n−1], 100]. Внутри отрезка — линейно.
 */
export function trackPos(avg: number, mins: number[]): number {
  const n = mins.length;
  if (n === 0) return 0;
  let k = 0;
  while (k < n && avg >= (mins[k] as number)) k++;
  const start = k === 0 ? (mins[0] as number) - 10 : (mins[k - 1] as number);
  const end = k === n ? 100 : (mins[k] as number);
  const frac = end > start ? (avg - start) / (end - start) : avg >= end ? 1 : 0;
  return (k + Math.min(1, Math.max(0, frac))) / (n + 1);
}
