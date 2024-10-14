import Redis from "ioredis";
import { TerminalsService } from "./modules/terminals/service";
import { IikoDictionariesService } from "../iiko_sync";
import cron from "node-cron";
import client from "./redis";

const terminalService = new TerminalsService(client);
const iikoDictionariesService = new IikoDictionariesService(client);

cron.schedule("0 6 * * *", async () => {
  await terminalService.getTerminalsFromIiko();
});

cron.schedule("30 5 * * *", async () => {
  console.log("Running a task every minute");
  await iikoDictionariesService.getIikoDictionariesFromIiko();
});
