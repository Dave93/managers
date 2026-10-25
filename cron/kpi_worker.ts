// Воркер KPI-уведомлений: доставка в Telegram, подметалка, ежедневные напоминания в 10:00 по Ташкенту.
// Вся логика живёт в backend/src/modules/kpi/worker; здесь только процесс и расписание.
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
import { runDaily } from "@backend/modules/kpi/worker/daily";
import { dailyIfDue, type DailyRedis } from "@backend/modules/kpi/worker/daily-guard";

const api = botApi();
if (!api) console.warn("kpi worker: KPI_BOT_TOKEN не задан — уведомления получают статус skipped (no_token)");

const queue = getKpiQueue();

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

registerSchedulers()
  .then(() => {
    // Процесс мог быть остановлен в 10:00: догоняем сразу (до 10:00 daily() ничего не делает), повторы погасит dedupe.
    return daily().catch((e) => console.error("kpi worker: ежедневная задача при старте не удалась", e));
  })
  .catch((e) => console.error("kpi worker: регистрация расписания не удалась", e));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`kpi worker: получен ${signal}, закрываем worker и queue...`);
  try {
    // close() без force ждёт уже начатые задачи: вызов Telegram успеет завершиться (см. kill_timeout в pm2.config.js).
    await worker.close();
    await queue.close();
  } catch (e) {
    console.error("kpi worker: ошибка при graceful shutdown", e);
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
