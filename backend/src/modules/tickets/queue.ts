import { Queue } from "bullmq";

export const TICKETS_QUEUE = "tickets-notify";
export const TICKETS_SWEEP_JOB = "tickets-outbox-sweep";

// Без removeOnComplete/removeOnFail Redis растёт без потолка: в arryt это
// вылилось в 3.41 ГБ, которые пришлось чистить руками.
export const jobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};

export function redisConnection() {
  return {
    host: process.env.REDIS_HOST ?? "localhost",
    port: parseInt(process.env.REDIS_PORT ?? "6379"),
  };
}

let queue: Queue | null = null;

export function getTicketsQueue(): Queue {
  if (!queue) {
    queue = new Queue(TICKETS_QUEUE, { connection: redisConnection() });
    // Queue — EventEmitter: необработанное 'error' (например, Redis моргнул)
    // роняет процесс. Для API это недопустимо.
    queue.on("error", (e) => console.error("tickets-notify queue error", e));
  }
  return queue;
}

export async function enqueueNotifications(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const q = getTicketsQueue();
  await Promise.all(
    notificationIds.map((id) =>
      q.add("deliver", { notificationId: id }, { ...jobOptions, jobId: id }).catch((e) => {
        // Постановка не удалась — строка в базе осталась pending, её подберёт
        // подметалка. Молча терять нельзя, падать тоже: заявка уже создана.
        console.error("tickets-notify enqueue failed", id, e);
      })
    )
  );
}
