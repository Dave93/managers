// Воркер сверки инвентаризаций с iiko (spec docs/superpowers/specs/2026-10-06-inventory-reconciliation-design.md).
// Задачи ставят бэкенд (кнопки офиса) и cron (1–7 числа). concurrency 1 — один токен iiko за раз.
import { Worker } from "bullmq";
import { drizzleDb } from "@backend/lib/db";
import { processReconcileJob } from "@backend/modules/inventory/reconcile/job";
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

async function shutdown() {
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
