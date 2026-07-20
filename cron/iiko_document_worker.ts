import { Worker } from "bullmq";
import dayjs from "dayjs";
import { IikoDictionariesService } from "./iiko_sync";
import client from "./src/redis";

// Имя должно совпадать с producer в backend/src/modules/iiko_sync/controllers.ts
const IIKO_DOCUMENT_SYNC_QUEUE = "iiko_document_sync";

const service = new IikoDictionariesService(client);

async function getIikoToken(): Promise<string> {
  const response = await service.fetchWithRetry(
    `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${process.env.IIKO_LOGIN}&pass=${process.env.IIKO_PASSWORD}`,
    { method: "GET" }
  );
  return await response.text();
}

async function releaseIikoToken(token: string): Promise<void> {
  try {
    await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/logout?key=${token}`,
      { method: "GET" }
    );
  } catch (e) {
    console.error("[worker] logout failed:", (e as Error).message);
  }
}

const worker = new Worker(
  IIKO_DOCUMENT_SYNC_QUEUE,
  async (job) => {
    const { type, date } = job.data as {
      type: "writeoff" | "internal_transfer";
      date: string;
    };
    // Окно ±1 день — страховка от таймзон
    const fromDate = dayjs(date).subtract(1, "day").format("YYYY-MM-DD");
    const toDate = dayjs(date).add(1, "day").format("YYYY-MM-DD");
    console.log(`[worker] job ${job.id}: ${type} ${fromDate}..${toDate}`);

    const token = await getIikoToken();
    try {
      if (type === "writeoff") {
        await service.getWriteOff(token, fromDate, toDate);
      } else {
        await service.getInternalTransfer(token, fromDate, toDate);
      }
    } finally {
      await releaseIikoToken(token);
    }
    console.log(`[worker] job ${job.id}: done`);
  },
  {
    // BullMQ требует отдельного соединения с maxRetriesPerRequest: null —
    // клиент из ./src/redis не подходит
    connection: {
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    },
    concurrency: 1,
  }
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed: ${err.message}`);
});

worker.on("error", (err) => {
  console.error(`[worker] error: ${err.message}`);
});

console.log("[worker] iiko_document_sync worker started");
