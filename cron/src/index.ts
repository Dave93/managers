import Redis from "ioredis";
import { TerminalsService } from "./modules/terminals/service";
import { IikoDictionariesService } from "../iiko_sync";
import cron from "node-cron";
import client from "./redis";
import { enqueueReconcile, reconcileQueue } from "@backend/modules/inventory/reconcile/queue";
import { previousPeriod } from "@backend/modules/inventory/rules";

const terminalService = new TerminalsService(client);
const iikoDictionariesService = new IikoDictionariesService(client);

cron.schedule("0 6 * * *", async () => {
  await terminalService.getTerminalsFromIiko();
});

cron.schedule("30 5 * * *", async () => {
  console.log("Running a task every minute");
  await iikoDictionariesService.getIikoDictionariesFromIiko();
});

// Сверка инвентаризаций с iiko за прошлый месяц: 1–7 числа, 07:00 по Ташкенту
// (spec 2026-10-06, §5). Задача уходит в очередь, считает inventory_reconcile_worker.
cron.schedule(
  "0 7 1-7 * *",
  async () => {
    const period = previousPeriod(new Date());
    try {
      await enqueueReconcile(reconcileQueue(), client, { period });
      console.log(`[reconcile] queued ${period}`);
    } catch (e) {
      console.error(`[reconcile] not queued ${period}:`, (e as Error).message);
    }
  },
  { timezone: "Asia/Tashkent" }
);
