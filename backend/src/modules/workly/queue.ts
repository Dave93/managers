import { Queue } from "bullmq";
import { redisConnection } from "../kpi/queue";

// Очередь фоновых прогонов Workly (раздел 5.9 спеки). Отдельная от kpi-notify:
// обход в 70–100 секунд не должен занимать слоты доставки Telegram.
export const WORKLY_RUN_JOB = "workly-run";

// Имя читается при вызове: тесты ставят WORKLY_QUEUE до первого обращения,
// и боевая очередь «workly-sync» им недоступна.
export function worklyQueueName(): string {
  return process.env.WORKLY_QUEUE || "workly-sync";
}

// Прогон не повторяется сам: повтор обхода решает человек или следующая ночь.
const runJobOptions = {
  attempts: 1,
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 86400 },
};

let queue: Queue | null = null;

export function getWorklyQueue(): Queue {
  if (!queue) {
    queue = new Queue(worklyQueueName(), { connection: redisConnection() });
    // Queue — EventEmitter: необработанное 'error' (Redis моргнул) роняет процесс.
    queue.on("error", (e) => console.error("workly-sync queue error", e));
  }
  return queue;
}

// Подмена в тестах: задача не ставится в Redis, а уходит в эту функцию.
let enqueuer: ((runId: string) => Promise<void>) | null = null;

export function setRunEnqueuer(f: ((runId: string) => Promise<void>) | null): void {
  enqueuer = f;
}

export async function enqueueRun(runId: string): Promise<void> {
  if (enqueuer) return enqueuer(runId);
  await getWorklyQueue().add(WORKLY_RUN_JOB, { runId }, runJobOptions);
}
