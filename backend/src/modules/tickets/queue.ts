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

// НЕ await'ится вызывающим кодом до конца постановки в очередь — вызывается
// из HTTP-пути (controller.ts) ПОСЛЕ коммита транзакции, а Queue.add() ждёт
// waitUntilReady() и, если Redis лежит, копится в offline-очереди ioredis
// (дефолтный maxRetriesPerRequest) заметно дольше минуты, прежде чем вообще
// отклонить промис. `await enqueueNotifications(...)` в контроллере значило
// бы, что при лежащем Redis (он на этой машине уже перезапускался) заявка на
// планшете менеджера висит дольше клиентского таймаута — тот жмёт "отправить"
// повторно, и получаем два тикета с двумя наборами фото.
//
// Выбран fire-and-forget (`void enqueueNotifications(...)` эффективно, без
// правки вызывающих файлов — они вне зоны этой правки), а не гонка с
// таймаутом: строка уже закоммичена как 'pending' ДО вызова этой функции, и
// tickets_worker.ts sweep() существует ровно для случая "Redis лежал в
// момент постановки" — он подберёт такую строку сам в течение 2 минут, даже
// если этот вызов вообще не вернётся. Гонка с таймаутом добавила бы таймер и
// AbortController ради результата, который sweep() и так даёт бесплатно.
//
// Функция остаётся `async` и возвращает Promise<void> ради обратной
// совместимости сигнатуры — просто ничего не ждёт внутри, поэтому
// возвращается (и разрешается) почти немедленно вне зависимости от Redis.
export async function enqueueNotifications(notificationIds: string[]): Promise<void> {
  if (notificationIds.length === 0) return;
  const q = getTicketsQueue();
  void Promise.all(
    notificationIds.map((id) =>
      q.add("deliver", { notificationId: id }, { ...jobOptions, jobId: id }).catch((e) => {
        // Постановка не удалась — строка в базе осталась pending, её подберёт
        // подметалка. Молча терять нельзя, падать тоже: заявка уже создана.
        console.error("tickets-notify enqueue failed", id, e);
      })
    )
  );
}
