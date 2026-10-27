import { tashkentDay } from "../time";
import { tashkentHour } from "./daily-plan";

// Отметка «ежедневная задача за этот день выполнена». Ставится после успешного прогона: если процесс упал посреди,
// следующий запуск повторит, а повторы гасит dedupe_key. Ключ живёт двое суток.
export interface DailyRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

export const DAILY_TTL_SEC = 2 * 24 * 3600;

export const dailyKey = (prefix: string | undefined, day: string): string => `${prefix ?? ""}kpi_daily:${day}`;

export async function dailyDone(r: DailyRedis, prefix: string | undefined, day: string): Promise<boolean> {
  return (await r.get(dailyKey(prefix, day))) !== null;
}

export async function markDailyDone(r: DailyRedis, prefix: string | undefined, day: string): Promise<void> {
  await r.set(dailyKey(prefix, day), "1", "EX", DAILY_TTL_SEC);
}

export const DAILY_HOUR = 10;

export type DailyOutcome = { day: string; skipped: "before_hour" | "already_ran" } | { day: string; created: number };

// Ежедневная задача «если пора»: после 10:00 по Ташкенту и пока за сегодня нет отметки.
// Зовётся из расписания в 10:00, при старте процесса и из каждого тика подметалки: упавший прогон повторится в течение дня.
// Повторы безвредны: строки уведомлений гасит dedupe_key.
export async function dailyIfDue(
  r: DailyRedis,
  prefix: string | undefined,
  at: Date,
  run: (at: Date) => Promise<string[]>
): Promise<DailyOutcome> {
  const day = tashkentDay(at);
  if (tashkentHour(at) < DAILY_HOUR) return { day, skipped: "before_hour" };
  if (await dailyDone(r, prefix, day)) return { day, skipped: "already_ran" };
  const ids = await run(at);
  await markDailyDone(r, prefix, day);
  return { day, created: ids.length };
}
