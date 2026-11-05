// Карточка сотрудника: преобразования ответа GET /kpi/employees/:id/profile для отображения.
import type { BoardDay } from "@admin/lib/kpi-api";
import type { TgAttendance, TgTier } from "@backend/modules/kpi/tg-app/types";

const TASHKENT_MS = 5 * 3600_000;

/** HH:MM по Ташкенту из метки времени; null — отметки нет. */
export function hhmm(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + TASHKENT_MS).toISOString().slice(11, 16);
}

/**
 * Дни месяца в том же виде, что в табеле: [статус, минуты опоздания, приход, уход] или null без записи.
 * Дни приходят новыми сверху и только со строкой в kpi_attendance.
 */
export function attendanceDays(daysInMonth: number, a: Pick<TgAttendance, "days">): (BoardDay | null)[] {
  const out: (BoardDay | null)[] = Array.from({ length: daysInMonth }, () => null);
  for (const d of a.days) {
    const i = Number(d.day.slice(8, 10)) - 1;
    if (i < 0 || i >= daysInMonth) continue;
    out[i] = d.absent ? [2, 0, null, null] : [d.late_minutes > 0 ? 1 : 0, d.late_minutes, hhmm(d.check_in), hhmm(d.check_out)];
  }
  return out;
}

/** Число дней месяца YYYY-MM-01. */
export function daysInPeriod(period: string): number {
  return new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
}

/** Достигнутая ступень прибавки при среднем баллом avg; null — ниже первой ступени или среднего нет. */
export function reachedTier(avg: number | null, tiers: readonly TgTier[]): TgTier | null {
  if (avg === null) return null;
  let best: TgTier | null = null;
  for (const t of tiers) if (avg >= t.min_pct && (!best || t.min_pct > best.min_pct)) best = t;
  return best;
}

/**
 * «Где потеряны баллы»: пункты ниже 100, худшие первыми, при равенстве по порядку в карте, не больше трёх.
 * То же правило, что на главном экране мини-приложения (backend tg-app/rules.ts lostItems).
 */
export function lostItems<T extends { score: number | null }>(items: readonly T[]): T[] {
  return items
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.score !== null && x.score < 100)
    .sort((a, b) => (a.x.score as number) - (b.x.score as number) || a.i - b.i)
    .slice(0, 3)
    .map(({ x }) => x);
}

/** Название на языке интерфейса: узбекское, если оно есть, иначе русское. */
export function pickTitle(locale: string, ru: string | null, uz: string | null): string {
  const uzLocale = locale === "uz-Latn" || locale === "uz-Cyrl";
  return (uzLocale && uz && uz.trim() ? uz : ru) ?? "";
}
