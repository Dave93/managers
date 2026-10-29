// Одна загрузка сверки: токен iiko, этапы 1–2, статус в Redis. Вызывают воркер
// очереди и ручной запуск cron/inventory_reconcile_once.ts.
import type Redis from "ioredis";
import type { DbLike } from "../access";
import { withIikoClient, type IikoClientOptions } from "./iiko-client";
import { patchStatus, type ReconcileJobData } from "./queue";
import { runReconcile } from "./service";

export async function processReconcileJob(db: DbLike, redis: Redis, data: ReconcileJobData, iikoOpts: IikoClientOptions = {}) {
  try {
    await withIikoClient(
      (iiko) =>
        runReconcile(db, iiko, { period: data.period, storeId: data.storeId, userId: data.userId }, (p) =>
          patchStatus(redis, data.statusKey, p)
        ),
      iikoOpts
    );
  } catch (e) {
    await patchStatus(redis, data.statusKey, {
      state: "failed",
      finished_at: new Date().toISOString(),
      error: (e as Error).message.slice(0, 500),
    });
    throw e;
  }
}
