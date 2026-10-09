// Воркер сверки инвентаризаций с iiko (spec docs/superpowers/specs/2026-10-06-inventory-reconciliation-design.md).
// Задачи ставят бэкенд (кнопки офиса) и cron (1–7 числа). concurrency 1 — один токен iiko за раз.
import { Worker } from "bullmq";
import { drizzleDb } from "@backend/lib/db";
import { inventory_counts } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { processReconcileJob } from "@backend/modules/inventory/reconcile/job";
import { fetchBook } from "@backend/modules/inventory/book/service";
import { bookQueueName, type BookJobData } from "@backend/modules/inventory/book/queue";
import { withIikoClient } from "@backend/modules/inventory/reconcile/iiko-client";
import { reconcileQueueName, type ReconcileJobData } from "@backend/modules/inventory/reconcile/queue";
import client from "./src/redis";

const worker = new Worker(
  reconcileQueueName(),
  async (job) => {
    const data = job.data as ReconcileJobData;
    console.log(`[reconcile] job ${job.id}: ${data.period} ${data.storeId ?? "all"}`);
    await processReconcileJob(drizzleDb, client, data);
    console.log(`[reconcile] job ${job.id}: done`);
  },
  {
    // BullMQ требует отдельного соединения с maxRetriesPerRequest: null
    connection: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    },
    concurrency: 1,
  }
);

worker.on("failed", (job, err) => console.error(`[reconcile] job ${job?.id} failed:`, err.message));

// Снимки книжного количества по пересчётам (spec 2026-10-08, §5): тот же процесс, отдельная очередь.
const bookWorker = new Worker(
  bookQueueName(),
  async (job) => {
    const { countId } = job.data as BookJobData;
    // Пересчёт вернули в черновик или удалили — iiko не трогаем и не повторяем.
    const [count] = await drizzleDb.select({ status: inventory_counts.status }).from(inventory_counts).where(eq(inventory_counts.id, countId));
    if (count?.status !== "submitted") {
      console.log(`[book] job ${job.id}: skipped (${count?.status ?? "missing"})`);
      return;
    }
    const r = await withIikoClient((iiko) => fetchBook(drizzleDb, iiko, countId));
    console.log(`[book] job ${job.id}: ${r.lines} lines, ${r.inconsistent} inconsistent`);
  },
  {
    connection: { host: process.env.REDIS_HOST || "localhost", port: parseInt(process.env.REDIS_PORT || "6379"), maxRetriesPerRequest: null },
    concurrency: 1,
  }
);
bookWorker.on("failed", (job, err) => console.error(`[book] job ${job?.id} failed:`, err.message));

async function shutdown() {
  await Promise.all([worker.close(), bookWorker.close()]);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
