// Eden treaty разбирает JSON с reviver-ом, который превращает строки,
// похожие на даты ("2026-10-31", ISO-время), в объекты Date. Модуль
// инвентаризаций работает со строками: period уходит обратно на сервер как
// "YYYY-MM-DD", а periodLabel делает split. Поэтому возвращаем строки:
// полночь UTC — это дата без времени (period), всё остальное — ISO.
export function normalizeDates<T>(value: T): T {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return (iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => normalizeDates(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalizeDates(v);
    return out as T;
  }
  return value;
}
