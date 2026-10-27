import { Queue } from "bullmq";

export const KPI_DELIVER_JOB = "deliver";
export const KPI_SWEEP_JOB = "kpi-sweep";
export const KPI_DAILY_JOB = "kpi-daily";

// Имя читается при вызове: тесты ставят KPI_NOTIFY_QUEUE до первого обращения,
// и боевая очередь «kpi-notify» им недоступна.
export function kpiQueueName(): string {
  return process.env.KPI_NOTIFY_QUEUE || "kpi-notify";
}

// Без removeOnComplete/removeOnFail Redis растёт без потолка (см. tickets/queue.ts).
export const deliverJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

// Повторяющиеся задачи (подметалка, ежедневная): хранить историю незачем.
export const schedulerJobOptions = {
  removeOnComplete: { count: 10 },
  removeOnFail: { age: 86400 },
};

export function redisConnection(): { host: string; port: number } {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
  };
}

let queue: Queue | null = null;

export function getKpiQueue(): Queue {
  if (!queue) {
    queue = new Queue(kpiQueueName(), { connection: redisConnection() });
    // Queue — EventEmitter: необработанное 'error' (Redis моргнул) роняет процесс.
    queue.on("error", (e) => console.error("kpi-notify queue error", e));
  }
  return queue;
}
