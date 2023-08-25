import { Elysia } from "elysia";
import { cron } from "@elysiajs/cron";
import Redis from "ioredis";
import { db } from "@backend/db";
import { TerminalsService } from "./modules/terminals/service";

const client = new Redis({ host: "localhost", port: 6379 });

const terminalService = new TerminalsService(db, client);

const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .use(
    cron({
      name: "heartbeat",
      pattern: "0 0 */1 * * *",
      async run() {
        await terminalService.getTerminalsFromIiko();
      },
    })
  )
  .listen(8080);

console.log(
  `🦊 Cron server is running at ${app.server?.hostname}:${app.server?.port}`
);
