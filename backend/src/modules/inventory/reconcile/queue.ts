// Очередь сверки (spec 2026-10-06, §5 «Очередь и запуск»). Одна задача на месяц:
// пока идёт загрузка периода, вторую (все склады или один) поставить нельзя.
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { InventoryError } from "../errors";
import type { ReconFetchStatus } from "./types";

export const reconcileQueueName = () => process.env.INVENTORY_RECONCILE_QUEUE ?? "inventory_reconcile";
// BullMQ не принимает ":" в собственных id задач.
export const reconcileJobId = (period: string) => `reconcile-${period}`;
// Ключ статуса считает тот, кто ставит задачу (бэкенд или cron), и передаёт в данных:
// у воркера в cron/ PROJECT_PREFIX может отличаться.
export const statusKey = (period: string) => `${process.env.PROJECT_PREFIX ?? ""}inventory_reconcile:${period}`;
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

export async function isRunning(q: Queue, period: string): Promise<boolean> {
  const job = await q.getJob(reconcileJobId(period));
  return !!job && RUNNING.has(await job.getState());
}

/** 409, пока идёт загрузка месяца: проверять ДО любых изменений, которые она перезапишет. */
export async function assertNotRunning(q: Queue, period: string) {
  if (await isRunning(q, period)) throw new InventoryError(409, "already_running");
}

export async function enqueueReconcile(
  q: Queue,
  redis: Redis,
  input: { period: string; storeId?: string | null; userId?: string | null }
): Promise<ReconFetchStatus> {
  const jobId = reconcileJobId(input.period);
  const existing = await q.getJob(jobId);
  if (existing) {
    if (RUNNING.has(await existing.getState())) throw new InventoryError(409, "already_running");
    await existing.remove();
  }
  const data: ReconcileJobData = {
    period: input.period,
    storeId: input.storeId ?? null,
    userId: input.userId ?? null,
    statusKey: statusKey(input.period),
  };
  const status = initialStatus(input.period, data.storeId);
  await redis.set(data.statusKey, JSON.stringify(status), "EX", STATUS_TTL_S);
  await q.add("reconcile", data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  return status;
}

const IN_PROGRESS = new Set(["queued", "stage1", "stage2"]);

/** Статус загрузки. Если воркер упал посреди задачи, в Redis остаётся «идёт», а задачи в очереди
 * уже нет — такой статус отдаём как failed/stale, чтобы кнопка снова стала доступна. */
export async function readStatus(redis: Redis, period: string, q?: Queue): Promise<ReconFetchStatus> {
  const raw = await redis.get(statusKey(period));
  if (!raw) return { ...initialStatus(period, null), state: "idle" };
  const s = JSON.parse(raw) as ReconFetchStatus;
  if (q && IN_PROGRESS.has(s.state) && !(await isRunning(q, period))) return { ...s, state: "failed", error: "stale" };
  return s;
}

export async function patchStatus(redis: Redis, key: string, patch: Partial<ReconFetchStatus>) {
  const raw = await redis.get(key);
  const cur = raw ? JSON.parse(raw) : {};
  await redis.set(key, JSON.stringify({ ...cur, ...patch }), "EX", STATUS_TTL_S);
}
