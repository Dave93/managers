// Чистые правила месяца экрана посещаемости (без импортов и env — тестируются без БД).
// Месяц везде строкой «YYYY-MM»; такие строки сравниваются лексикографически.

/** Строго «YYYY-MM» с месяцем 01..12; всё остальное — null. */
export function monthOf(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

/**
 * Соседи месяца `month` среди месяцев со строками (`withData`) плюс текущий месяц `current` (достижим всегда).
 * prev — наибольший месяц строго меньше `month`, next — наименьший строго больше; null — дальше нет.
 * Порядок и дубликаты в `withData` не важны.
 */
export function neighbours(withData: string[], month: string, current: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  for (const m of new Set([...withData, current])) {
    if (m < month && (prev === null || m > prev)) prev = m;
    if (m > month && (next === null || m < next)) next = m;
  }
  return { prev, next };
}
