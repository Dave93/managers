import { api_tokens } from "@backend/../drizzle/schema";
import { ctx } from "@backend/context";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { extractBearerToken, isValidApiToken } from "./auth";
import { buildSyncJob } from "./job";

// Имя должно совпадать с worker в cron/iiko_document_worker.ts
const IIKO_DOCUMENT_SYNC_QUEUE = "iiko_document_sync";

const iikoDocumentSyncQueue = new Queue(IIKO_DOCUMENT_SYNC_QUEUE, {
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: null,
  },
});

export const iikoSyncController = new Elysia({
  name: "@api/iiko_sync",
})
  .use(ctx)
  .post(
    "/iiko/sync-document",
    async ({ body, headers, set, cacheController, drizzle }) => {
      const token = extractBearerToken(headers.authorization);
      if (!token) {
        set.status = 401;
        return { message: "Unauthorized" };
      }

      // Сначала redis-кеш, при промахе — БД
      const cached = await cacheController.getCachedApiTokens({});
      let valid = isValidApiToken(cached, token);
      if (!valid) {
        const rows = await drizzle
          .select({ token: api_tokens.token, active: api_tokens.active })
          .from(api_tokens)
          .where(and(eq(api_tokens.token, token), eq(api_tokens.active, true)))
          .execute();
        valid = rows.length > 0;
      }
      if (!valid) {
        set.status = 401;
        return { message: "Unauthorized" };
      }

      const job = buildSyncJob(body.type, body.date);
      await iikoDocumentSyncQueue.add(job.name, job.data, job.opts);

      set.status = 202;
      return { queued: true };
    },
    {
      body: t.Object({
        type: t.Union([t.Literal("writeoff"), t.Literal("internal_transfer")]),
        date: t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      }),
    }
  );
