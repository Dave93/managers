// «Обработчик не запущен»: задачи книжного и сверки обрабатывает inventory_reconcile_worker (cron/).
// Если он не запущен, задачи молча висят в очереди, а на экране — вечное «загружается».
import type { Queue } from "bullmq";
import { bookQueue } from "../book/queue";
import { reconcileQueue } from "./queue";
import type { WorkerStatus } from "./types";

/** Сколько задача может ждать в очереди, пока это ещё не повод тревожить офис. */
export const STALL_AFTER_MS = 60_000;

export type QueueProbe = {
  /** Когда самая старая ожидающая задача стала готова к обработке (отложенные — с момента готовности). */
  oldestReadyAt: number | null;
  /** Подключённые обработчики; null — Redis не отдаёт список клиентов. */
  workers: number | null;
  active: number;
};

/** Задача ждёт дольше минуты и её некому взять. Без списка клиентов — «некому», если ничего не обрабатывается. */
export function isStalled(p: QueueProbe, now: number): boolean {
  if (p.oldestReadyAt === null || now - p.oldestReadyAt < STALL_AFTER_MS) return false;
  return p.workers === null ? p.active === 0 : p.workers === 0;
}

async function probe(q: Queue): Promise<QueueProbe> {
  const workers = await q.getWorkersCount().catch(() => null);
  const ready = (await q.getWaiting()).map((j) => j.timestamp + (j.delay ?? 0));
  // Обработчик упал посреди задачи: она так и числится «active», хотя её никто не делает.
  if (workers === 0) for (const j of await q.getActive()) ready.push(j.processedOn ?? j.timestamp);
  const { active } = await q.getJobCounts("active");
  return { oldestReadyAt: ready.length ? Math.min(...ready) : null, workers, active: active ?? 0 };
}

// Экран спрашивает каждые 15 с из каждой открытой вкладки, а проверка — CLIENT LIST и список
// ожидающих задач в Redis: один ответ на всех на 10 с.
const STATUS_TTL_MS = 10_000;
let lastStatus: { at: number; value: Promise<WorkerStatus> } | null = null;

/** Обе очереди обработчика. Redis недоступен — «всё в порядке»: эта проверка не должна ломать экран. */
export function readWorkerStatus(now = Date.now()): Promise<WorkerStatus> {
  const age = lastStatus ? now - lastStatus.at : Infinity;
  if (lastStatus && age >= 0 && age < STATUS_TTL_MS) return lastStatus.value;
  const entry = {
    at: now,
    value: probeWorkers(now).then(({ probeFailed, ...status }) => {
      // Ответ-заглушку при недоступном Redis не кэшируем: следующий запрос проверит заново.
      if (probeFailed && lastStatus === entry) lastStatus = null;
      return status;
    }),
  };
  lastStatus = entry;
  return entry.value;
}

export function clearWorkerStatusCache() {
  lastStatus = null;
}

async function probeWorkers(now: number): Promise<WorkerStatus & { probeFailed?: true }> {
  try {
    const stalled = (await Promise.all([bookQueue(), reconcileQueue()].map(probe))).filter((p) => isStalled(p, now));
    if (!stalled.length) return { stalled: false, waiting_since: null };
    return { stalled: true, waiting_since: new Date(Math.min(...stalled.map((p) => p.oldestReadyAt!))).toISOString() };
  } catch (e) {
    console.error("[inventory] worker status failed:", (e as Error).message);
    return { stalled: false, waiting_since: null, probeFailed: true };
  }
}
