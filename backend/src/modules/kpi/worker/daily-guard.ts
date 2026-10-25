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
