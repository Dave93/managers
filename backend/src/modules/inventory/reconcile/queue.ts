// Очередь сверки (spec 2026-10-06, §5 «Очередь и запуск»). Загрузка «все склады» — одна на месяц:
// пока она идёт, вторую поставить нельзя. Загрузка одного склада — своя задача и свой статус:
// склады встают в очередь друг за другом (воркер — concurrency 1, один токен iiko).
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { InventoryError } from "../errors";
import type { ReconFetchOverview, ReconFetchStatus } from "./types";

export const reconcileQueueName = () => process.env.INVENTORY_RECONCILE_QUEUE ?? "inventory_reconcile";
// BullMQ не принимает ":" в собственных id задач.
export const reconcileJobId = (period: string, storeId?: string | null) =>
  storeId ? `reconcile-${period}-${storeId}` : `reconcile-${period}`;
// Ключ статуса считает тот, кто ставит задачу (бэкенд или cron), и передаёт в данных:
// у воркера в cron/ PROJECT_PREFIX может отличаться.
export const statusKey = (period: string, storeId?: string | null) =>
  `${process.env.PROJECT_PREFIX ?? ""}inventory_reconcile:${period}${storeId ? `:${storeId}` : ""}`;
/** Склады месяца, по которым запускали загрузку одного склада: по ним отдаём статусы строк. */
const storesKey = (period: string) => `${statusKey(period)}:stores`;
const STATUS_TTL_S = 30 * 86400;

export type ReconcileJobData = { period: string; storeId: string | null; userId: string | null; statusKey: string };

let queue: Queue | null = null;

export function reconcileQueue(): Queue {
  queue ??= new Queue(reconcileQueueName(), {
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    },
  });
  return queue;
}

export async function closeReconcileQueue() {
  await queue?.close();
  queue = null;
}

export function initialStatus(period: string, storeId: string | null): ReconFetchStatus {
  return { period, store_id: storeId, state: "queued", started_at: null, stage1_done_at: null, finished_at: null, received: [], missing: [], error: null };
}

const RUNNING = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

export async function isRunning(q: Queue, period: string, storeId?: string | null): Promise<boolean> {
  const job = await q.getJob(reconcileJobId(period, storeId));
  return !!job && RUNNING.has(await job.getState());
}

/** 409, пока идёт загрузка месяца или этого склада: проверять ДО любых изменений, которые она перезапишет. */
export async function assertNotRunning(q: Queue, period: string, storeId?: string | null) {
  if ((await isRunning(q, period)) || (storeId && (await isRunning(q, period, storeId)))) {
    throw new InventoryError(409, "already_running");
  }
}

export async function enqueueReconcile(
  q: Queue,
  redis: Redis,
  input: { period: string; storeId?: string | null; userId?: string | null }
): Promise<ReconFetchStatus> {
  const storeId = input.storeId ?? null;
  const jobId = reconcileJobId(input.period, storeId);
  const existing = await q.getJob(jobId);
  if (existing) {
    if (RUNNING.has(await existing.getState())) {
      // Склад уже в очереди — повторное нажатие ничего не ставит, отдаёт текущий статус.
      if (storeId) return readStatus(redis, input.period, q, storeId);
      throw new InventoryError(409, "already_running");
    }
    await existing.remove();
  }
  const data: ReconcileJobData = {
    period: input.period,
    storeId,
    userId: input.userId ?? null,
    statusKey: statusKey(input.period, storeId),
  };
  const status = initialStatus(input.period, storeId);
  await redis.set(data.statusKey, JSON.stringify(status), "EX", STATUS_TTL_S);
  if (storeId) {
    await redis.sadd(storesKey(input.period), storeId);
    await redis.expire(storesKey(input.period), STATUS_TTL_S);
  }
  await q.add("reconcile", data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  return status;
}

const IN_PROGRESS = new Set(["queued", "stage1", "stage2"]);

/** Статус загрузки. Если воркер упал посреди задачи, в Redis остаётся «идёт», а задачи в очереди
 * уже нет — такой статус отдаём как failed/stale, чтобы кнопка снова стала доступна. */
export async function readStatus(redis: Redis, period: string, q?: Queue, storeId?: string | null): Promise<ReconFetchStatus> {
  const raw = await redis.get(statusKey(period, storeId));
  if (!raw) return { ...initialStatus(period, storeId ?? null), state: "idle" };
  const s = JSON.parse(raw) as ReconFetchStatus;
  if (q && IN_PROGRESS.has(s.state) && !(await isRunning(q, period, storeId))) return { ...s, state: "failed", error: "stale" };
  return s;
}

/** Статус месяца («все склады») и статусы загрузок отдельных складов — для строк списка. */
export async function readStatusOverview(redis: Redis, period: string, q?: Queue): Promise<ReconFetchOverview> {
  const ids = await redis.smembers(storesKey(period));
  const stores = (await Promise.all(ids.map((id) => readStatus(redis, period, q, id)))).filter((s) => s.state !== "idle");
  return { ...(await readStatus(redis, period, q)), stores };
}

export async function patchStatus(redis: Redis, key: string, patch: Partial<ReconFetchStatus>) {
  const raw = await redis.get(key);
  const cur = raw ? JSON.parse(raw) : {};
  await redis.set(key, JSON.stringify({ ...cur, ...patch }), "EX", STATUS_TTL_S);
}
