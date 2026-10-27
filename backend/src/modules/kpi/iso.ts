// Время в ответах API — только ISO 8601 UTC ("2025-08-25T05:00:00.000Z").
// Postgres отдаёт timestamptz текстом вида "2025-08-25 10:00:00.123456+05", его приводим здесь.
export function iso(v: string | Date): string;
export function iso(v: string | Date | null): string | null;
export function iso(v: string | Date | null): string | null {
  if (v === null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`kpi: не время: ${String(v)}`);
  return d.toISOString();
}
