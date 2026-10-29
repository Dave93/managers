// Одна загрузка ОСВ: токен iiko, снимок, статус в Redis. Вызывают воркер и cron/inventory_turnover_once.ts.
import type Redis from "ioredis";
import type { DbLike } from "../access";
import { withIikoClient, type IikoClientOptions } from "../reconcile/iiko-client";
import { patchTurnoverStatus, type TurnoverJobData } from "./queue";
import { fetchTurnover } from "./service";

export async function processTurnoverJob(db: DbLike, redis: Redis, data: TurnoverJobData, iikoOpts: IikoClientOptions = {}) {
  try {
    return await withIikoClient(
      (iiko) => fetchTurnover(db, iiko, { period: data.period, storeId: data.storeId }, (p) => patchTurnoverStatus(redis, data.statusKey, p)),
      iikoOpts
    );
  } catch (e) {
    await patchTurnoverStatus(redis, data.statusKey, { state: "failed", finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 500) });
    throw e;
  }
}
