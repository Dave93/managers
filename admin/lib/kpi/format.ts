// Форматирование по Asia/Tashkent и русской локали. Пробелы в числах и перед знаком — U+00A0.
// Строки собираем вручную, без Intl: результат не зависит от ICU и зоны браузера.

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const NBSP = " ";
const pad = (n: number) => String(n).padStart(2, "0");

export function formatTashkent(iso: string | null, withTime = true): string {
  if (!iso) return "—";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (day) return `${day[3]}.${day[2]}.${day[1]}`;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const t = new Date(ms + TASHKENT_OFFSET_MS);
  const date = `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}.${t.getUTCFullYear()}`;
  return withTime ? `${date} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` : date;
}

/** Округление половины вверх без плавающих хвостов, как roundTo на backend (branch-rules.ts). */
export function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(+(x * f).toPrecision(12)) / f;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${String(roundTo(n, 2)).replace(".", ",")}${NBSP}%`;
}

export function formatSum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${group(String(Math.abs(r)))}${NBSP}сум`;
}

export function parseAmount(s: string): number | null {
  const t = s.replace(/[\s ]+/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
