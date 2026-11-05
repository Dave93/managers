// Выходные дни оценщика в мини-приложении. Тонкий слой над days-off.ts: ответ собирается поле за полем
// (given_by, terminal_id и время создания наружу не идут), месяц и право отмены считаются здесь.
import { parsePeriod, type Actor, type DbLike } from "../access";
import { cancelDayOff, giveDaysOff, listGivenDaysOff, type DayOffRow } from "../days-off";
import { isPeriodClosed } from "../periods";
import { periodOf } from "../time";
import type { EvDayOff, EvDaysOff, EvDaysOffCreated } from "./ev-types";

export function evDayOffOf(r: DayOffRow, canCancel: boolean): EvDayOff {
  return {
    id: r.id,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    terminal_name: r.terminal_name,
    day: r.day,
    reason_code: r.reason_code,
    reason_text: r.reason_text,
    status: r.cancelled_at === null ? "active" : "cancelled",
    can_cancel: canCancel,
  };
}

// Выданные дни по возрастанию; месяцы всех дней открыты (проверено внутри giveDaysOff), поэтому can_cancel = true.
export async function evGiveDaysOff(db: DbLike, actor: Actor, input: Parameters<typeof giveDaysOff>[2], at: Date): Promise<EvDaysOffCreated> {
  const { created, skipped } = await giveDaysOff(db, actor, input, at);
  return { created: created.map((r) => evDayOffOf(r, true)), skipped };
}

// period не задан (undefined) — месяц момента at; остальное проверяет parsePeriod (пустая строка — 422 bad_period).
export async function evDaysOff(db: DbLike, actor: Actor, period: unknown, at: Date): Promise<EvDaysOff> {
  const p = period === undefined ? periodOf(at) : parsePeriod(period);
  const closed = await isPeriodClosed(db, p);
  const rows = await listGivenDaysOff(db, actor, p);
  return { period: p, period_status: closed ? "closed" : "open", items: rows.map((r) => evDayOffOf(r, r.cancelled_at === null && !closed)) };
}

export async function evCancelDayOff(db: DbLike, actor: Actor, id: string): Promise<EvDayOff> {
  return evDayOffOf(await cancelDayOff(db, actor, id), false);
}
