import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { botApi } from "../tg/bot-api";
import { handleUpdate } from "../tg/bot";
import { parseUpdate, secretOk } from "../tg/updates";

// Публичный роут Telegram. После проверки секрета всегда отвечает 200: не-2xx Telegram считает временным сбоем
// и повторяет апдейт без конца, а наши ошибки конфигурации и сбои базы повтор не лечит.
// Поэтому здесь нет run(): ошибки ловятся и логируются, а доставку уведомлений от спора ставит сам handleUpdate
// через collectDeliveries, только после успешного коммита.
export const botRoutes = new Elysia({ name: "@api/kpi/bot" })
  .use(ctx)
  .post(
    "/kpi/bot/webhook",
    async ({ headers, body, drizzle, redis, set }) => {
      const secret = process.env.KPI_WEBHOOK_SECRET;
      if (!secret) {
        console.error("kpi bot: KPI_WEBHOOK_SECRET не задан");
        return { ok: true };
      }
      if (!secretOk(headers["x-telegram-bot-api-secret-token"], secret)) {
        set.status = 401;
        return { ok: false };
      }
      try {
        const u = parseUpdate(body);
        if (u.type === "ignore") return { ok: true };
        const api = botApi();
        if (!api) {
          console.error("kpi bot: KPI_BOT_TOKEN не задан");
          return { ok: true };
        }
        await handleUpdate(u, { db: drizzle, redis, api });
      } catch (e) {
        console.error("kpi bot: необработанная ошибка вебхука", e instanceof Error ? e.message.replace(/[0-9a-f]{32}/gi, "***") : "unknown");
      }
      return { ok: true };
    },
    { body: t.Any() }
  );
