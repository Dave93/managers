// Воркер KPI-уведомлений: доставка в Telegram, подметалка, ежедневные напоминания в 10:00 по Ташкенту.
// Вторым Worker в этом же процессе идёт очередь Workly (прогоны сверки и посещаемости, ночной прогон в 03:30).
// Вся логика живёт в backend/src/modules/kpi/worker и backend/src/modules/workly; здесь только процесс и расписание.
// drizzle-orm здесь не импортируем: у cron другая версия, чем у backend, а база приходит из @backend/lib/db.
// После деплоя бэкенда процесс нужно перезапускать отдельно: он исполняет тексты и правила из backend.
import { DelayedError, Worker, type Job } from "bullmq";
import { drizzleDb } from "@backend/lib/db";
import {
  KPI_DAILY_JOB,
  KPI_DELIVER_JOB,
  KPI_SWEEP_JOB,
  getKpiQueue,
  kpiQueueName,
  redisConnection,
  schedulerJobOptions,
} from "@backend/modules/kpi/queue";
import { botApi } from "@backend/modules/kpi/tg/bot-api";
import { deliverOne, stuckReporter, stuckSendingCount, sweepPending } from "@backend/modules/kpi/worker/deliver";
import { startScheduling } from "@backend/modules/kpi/worker/boot";
import { runDaily } from "@backend/modules/kpi/worker/daily";
import { dailyIfDue, type DailyRedis } from "@backend/modules/kpi/worker/daily-guard";
import { WORKLY_ACTIVITY_JOB } from "@backend/modules/workly/activity";
import { WORKLY_NIGHTLY_JOB, failedJobCode, jobFailureCode, worklyJobProcessor } from "@backend/modules/workly/nightly";
import { getWorklyQueue, worklyQueueName } from "@backend/modules/workly/queue";

// Redis, которого ждут прогоны Workly (тип ioredis из backend; у cron своя версия пакета).
type WorklyRedis = Parameters<typeof worklyJobProcessor>[1] extends () => Promise<infer R> ? R : never;

const api = botApi();
if (!api) console.warn("kpi worker: KPI_BOT_TOKEN не задан — уведомления получают статус skipped (no_token)");

const queue = getKpiQueue();
const worklyQueue = getWorklyQueue();

async function registerSchedulers() {
  await queue.upsertJobScheduler(
    KPI_SWEEP_JOB,
    { pattern: "*/2 * * * *" },
    { name: KPI_SWEEP_JOB, opts: schedulerJobOptions }
  );
  await queue.upsertJobScheduler(
    KPI_DAILY_JOB,
    { pattern: "0 10 * * *", tz: "Asia/Tashkent" },
    { name: KPI_DAILY_JOB, opts: schedulerJobOptions }
  );
  // Ночная сверка Workly: 03:30 по Ташкенту (время выбрано при планировании).
  await worklyQueue.upsertJobScheduler(
    WORKLY_NIGHTLY_JOB,
    { pattern: "30 3 * * *", tz: "Asia/Tashkent" },
    { name: WORKLY_NIGHTLY_JOB, opts: schedulerJobOptions }
  );
  // Опрос действий пользователей Workly: каждые 15 минут, со сдвигом, чтобы не попадать на 03:30
  // ночного прогона и на круглые минуты. Выключается WORKLY_ACTIVITY_POLL=0 (проверяется в задаче).
  await worklyQueue.upsertJobScheduler(
    WORKLY_ACTIVITY_JOB,
    { pattern: "7,22,37,52 * * * *", tz: "Asia/Tashkent" },
    { name: WORKLY_ACTIVITY_JOB, opts: schedulerJobOptions }
  );
}

// job.attemptsMade — уже состоявшиеся попытки, job.opts.attempts — потолок.
const isLastAttempt = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

async function deliver(job: Job, token?: string) {
  const out = await deliverOne(drizzleDb, job.data.notificationId as string, { api, lastAttempt: isLastAttempt(job) });
  if (out.result !== "retry") return out;
  if (out.retryAfterMs !== undefined) {
    // Лимит Telegram не должен стоить попытки: откладываем задачу на названное время.
    await job.moveToDelayed(Date.now() + out.retryAfterMs, token);
    throw new DelayedError();
  }
  throw new Error(out.error);
}

const reportStuck = stuckReporter((n) =>
  console.warn(`kpi worker: ${n} уведомлений в 'sending' дольше 15 минут — не сбрасываем (риск дубля), посмотрите глазами`)
);

async function sweep() {
  const res = await sweepPending(drizzleDb, queue, { olderThanSec: 60, limit: 200 });
  const stuck = await stuckSendingCount(drizzleDb, 15);
  reportStuck(stuck);
  // Упавший прогон в 10:00 повторяем в течение дня: отметка в Redis ставится только после успеха.
  await daily().catch((e) => console.error("kpi worker: ежедневная задача из подметалки не удалась", e));
  return { ...res, stuckSending: stuck };
}

// Повторный запуск в тот же день безвреден (dedupe_key), но лишней работы не делаем: отметка в Redis ставится после успеха.
async function daily() {
  const redis = (await queue.client) as unknown as DailyRedis;
  const out = await dailyIfDue(redis, process.env.PROJECT_PREFIX, new Date(), (at) => runDaily(drizzleDb, at));
  if ("created" in out) console.log(`kpi worker: ежедневная задача ${out.day}: новых уведомлений ${out.created}`);
  return out;
}

const worker = new Worker(
  kpiQueueName(),
  async (job, token) => {
    if (job.name === KPI_SWEEP_JOB) return sweep();
    if (job.name === KPI_DAILY_JOB) return daily();
    if (job.name === KPI_DELIVER_JOB) return deliver(job, token);
    throw new Error(`kpi worker: неизвестная задача ${job.name}`);
  },
  {
    connection: redisConnection(),
    concurrency: 5,
    // Потолок Telegram около 30 сообщений в секунду; упираться в него не стоит.
    limiter: { max: 25, duration: 1000 },
  }
);

worker.on("error", (e) => console.error("kpi worker error", e));
worker.on("failed", (job, e) => console.error("kpi job failed", job?.name, job?.id, e?.message));
console.log(`kpi worker started (queue ${kpiQueueName()}, token: ${api ? "есть" : "нет"})`);

// Очередь Workly: обход 70–100 секунд, поэтому отдельный Worker без limiter и по одной задаче за раз
// (обходы одного клиента не должны идти параллельно, см. client.ts). Слоты доставки Telegram он не занимает.
// Сообщения исключений ни в лог, ни в BullMQ не попадают: handleWorklyJob отдаёт только код (в базе у
// DrizzleQueryError параметры запроса с именами сотрудников, а failedReason хранится в Redis).
// Redis-клиент очереди берётся внутри обработчика (worklyJobProcessor), поэтому и его сбой уходит кодом.
const worklyWorker = new Worker(
  worklyQueueName(),
  worklyJobProcessor(drizzleDb, async () => (await worklyQueue.client) as unknown as WorklyRedis),
  { connection: redisConnection(), concurrency: 1 }
);

worklyWorker.on("error", (e) => console.error("workly worker error", jobFailureCode(e)));
worklyWorker.on("failed", (job, e) => console.error("workly job failed", job?.name, job?.id, failedJobCode(e)));
console.log(`workly worker started (queue ${worklyQueueName()})`);

// Без расписаний процесс ничего не делает по времени: при провале регистрации выходим, PM2 перезапустит.
void startScheduling({
  register: registerSchedulers,
  catchUp: daily,
  log: (msg, e) => console.error(msg, e),
  exit: (code) => process.exit(code),
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`kpi worker: получен ${signal}, закрываем worker и queue...`);
  try {
    // close() без force ждёт уже начатые задачи: вызов Telegram и обход Workly успеют завершиться
    // (см. kill_timeout в pm2.config.js). Очереди закрываем только после воркеров: обход берёт
    // Redis-клиент очереди Workly (токен), под идущим обходом его закрывать нельзя.
    const [kpiClosed, worklyClosed] = await Promise.allSettled([worker.close(), worklyWorker.close()]);
    const [kpiQueueClosed, worklyQueueClosed] = await Promise.allSettled([queue.close(), worklyQueue.close()]);
    for (const r of [kpiClosed, kpiQueueClosed]) {
      if (r.status === "rejected") console.error("kpi worker: ошибка при graceful shutdown", r.reason);
    }
    // Очередь и воркер Workly: только код, без текста исключения.
    for (const r of [worklyClosed, worklyQueueClosed]) {
      if (r.status === "rejected") console.error("workly worker: ошибка при graceful shutdown", jobFailureCode(r.reason));
    }
  } catch (e) {
    console.error("kpi worker: ошибка при graceful shutdown", e);
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
