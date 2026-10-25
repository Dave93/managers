// Чистый план дня: кому и что отправить сегодня. Без базы и очереди, время приходит аргументом.
import type { NotifyInput } from "../notify";
import { addMonths, currentReviewPeriod, periodOf, reminderFrom, reviewDeadline, submitOpensAt, tashkentDay, type Period } from "../time";
import type { Lagging } from "../periods";

export type DailyTargets = {
  today: string;
  remind: { period: Period; deadline: string } | null;
  overdue: { period: Period } | null;
};

const DAY_MS = 24 * 3600 * 1000;
const OVERDUE_LIST_LIMIT = 100;

export function dailyTargets(at: Date, s: { review_deadline_day: number; reminder_days_before: number }): DailyTargets {
  const rd = s.review_deadline_day;
  const t = at.getTime();
  const P = currentReviewPeriod(at, rd);
  const deadline = reviewDeadline(P, rd);
  // Напоминать раньше, чем откроется приём оценок за период (с 20-го числа), нет смысла: оценить пока нельзя.
  const from = Math.max(reminderFrom(P, rd, s.reminder_days_before).getTime(), submitOpensAt(P).getTime());
  const remind =
    from <= t && t <= deadline.getTime()
      ? { period: P, deadline: deadline.toISOString() }
      : null;
  // Сводка уходит на следующий день после срока. Считаем через «вчера»: если срок выпал на последний день месяца,
  // «вчера» ещё лежит в прошлом месяце, а период сводки определяется по нему.
  const yesterday = new Date(t - DAY_MS);
  const Q = addMonths(periodOf(yesterday), -1);
  const overdue = tashkentDay(reviewDeadline(Q, rd)) === tashkentDay(yesterday) ? { period: Q } : null;
  return { today: tashkentDay(at), remind, overdue };
}

export function remindNotifications(
  remind: { period: Period; deadline: string },
  today: string,
  lagging: { user_id: string; pending: number }[]
): NotifyInput[] {
  return lagging
    .filter((l) => l.pending > 0)
    .map((l) => ({
      recipient_kind: "user" as const,
      user_id: l.user_id,
      kind: "remind_evaluate",
      payload: { period: remind.period, pending: l.pending, deadline: remind.deadline },
      dedupe_key: `remind:${l.user_id}:${today}`,
    }));
}

export function overdueNotifications(period: Period, lagging: Lagging[], approverIds: string[]): NotifyInput[] {
  const list = lagging.slice(0, OVERDUE_LIST_LIMIT).map(({ user_name, pending }) => ({ user_name, pending }));
  return approverIds.map((user_id) => ({
    recipient_kind: "user" as const,
    user_id,
    kind: "overdue_summary",
    payload: { period, lagging: list, lagging_total: lagging.length },
    dedupe_key: `overdue:${period}:${user_id}`,
  }));
}

// Час суток по Ташкенту (UTC+5, без перехода на летнее время).
export function tashkentHour(at: Date): number {
  return (at.getUTCHours() + 5) % 24;
}
