// Очередь снимков ОСВ (spec 2026-10-14, §6). «Все склады» месяца — одна задача; один склад — своя.
// Воркер — concurrency 1, один токен iiko.
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { InventoryError } from "../errors";
import type { TurnoverFetchOverview, TurnoverFetchStatus } from "./types";

export const turnoverQueueName = () => process.env.INVENTORY_TURNOVER_QUEUE ?? "inventory_turnover";
// BullMQ не принимает ":" в собственных id задач.
export const turnoverJobId = (period: string, storeId?: string | null) => (storeId ? `turnover-${period}-${storeId}` : `turnover-${period}`);
// Ключ считает тот, кто ставит задачу (бэкенд или cron): у воркера PROJECT_PREFIX может отличаться.
export const turnoverStatusKey = (period: string, storeId?: string | null) =>
  `${process.env.PROJECT_PREFIX ?? ""}inventory_turnover:${period}${storeId ? `:${storeId}` : ""}`;
const storesKey = (period: string) => `${turnoverStatusKey(period)}:stores`;
const STATUS_TTL_S = 30 * 86400;

export type TurnoverJobData = { period: string; storeId: string | null; statusKey: string };

let queue: Queue | null = null;

export function turnoverQueue(): Queue {
  queue ??= new Queue(turnoverQueueName(), {
    connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || "6379"), maxRetriesPerRequest: null },
  });
  return queue;
}

export async function closeTurnoverQueue() {
  await queue?.close();
  queue = null;
}

export function initialTurnoverStatus(period: string, storeId: string | null): TurnoverFetchStatus {
  return { period, store_id: storeId, state: "queued", total: 0, done: 0, failed: [], started_at: null, finished_at: null, error: null };
}

const RUNNING = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

async function isRunning(q: Queue, period: string, storeId?: string | null): Promise<boolean> {
  const job = await q.getJob(turnoverJobId(period, storeId));
  return !!job && RUNNING.has(await job.getState());
}

/** 409, пока идёт загрузка месяца или этого склада. */
export async function enqueueTurnover(q: Queue, redis: Redis, input: { period: string; storeId?: string | null }): Promise<TurnoverFetchStatus> {
  const storeId = input.storeId ?? null;
  if ((await isRunning(q, input.period)) || (storeId && (await isRunning(q, input.period, storeId)))) {
    throw new InventoryError(409, "already_running");
  }
  const jobId = turnoverJobId(input.period, storeId);
  const existing = await q.getJob(jobId);
  if (existing) await existing.remove();
  const data: TurnoverJobData = { period: input.period, storeId, statusKey: turnoverStatusKey(input.period, storeId) };
  const status = initialTurnoverStatus(input.period, storeId);
  await redis.set(data.statusKey, JSON.stringify(status), "EX", STATUS_TTL_S);
  if (storeId) {
    await redis.sadd(storesKey(input.period), storeId);
    await redis.expire(storesKey(input.period), STATUS_TTL_S);
  }
  await q.add("turnover", data, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  return status;
}

const IN_PROGRESS = new Set(["queued", "running"]);

/** Воркер упал посреди задачи — в Redis «идёт», а задачи нет: отдаём failed/stale, чтобы кнопка ожила. */
export async function readTurnoverStatus(redis: Redis, period: string, q?: Queue, storeId?: string | null): Promise<TurnoverFetchStatus> {
  const raw = await redis.get(turnoverStatusKey(period, storeId));
  if (!raw) return { ...initialTurnoverStatus(period, storeId ?? null), state: "idle" };
  const s = JSON.parse(raw) as TurnoverFetchStatus;
  if (q && IN_PROGRESS.has(s.state) && !(await isRunning(q, period, storeId))) return { ...s, state: "failed", error: "stale" };
  return s;
}

export async function readTurnoverOverview(redis: Redis, period: string, q?: Queue): Promise<TurnoverFetchOverview> {
  const ids = await redis.smembers(storesKey(period));
  const stores = (await Promise.all(ids.map((id) => readTurnoverStatus(redis, period, q, id)))).filter((s) => s.state !== "idle");
  return { ...(await readTurnoverStatus(redis, period, q)), stores };
}

export async function patchTurnoverStatus(redis: Redis, key: string, patch: Partial<TurnoverFetchStatus>) {
  const raw = await redis.get(key);
  const cur = raw ? JSON.parse(raw) : {};
  await redis.set(key, JSON.stringify({ ...cur, ...patch }), "EX", STATUS_TTL_S);
}
