// Клиент Bot API. Тесты подменяют его через setTestBotApi: в тестах реальный Telegram не вызывается.
import { interpretResponse, sendMessage, type TgResult } from "@backend/modules/tickets/telegram";
import type { OutMessage } from "./messages";

export type { TgResult };

export interface BotApi {
  send(chatId: number, msg: OutMessage): Promise<TgResult>;
  answerCallback(callbackId: string, text?: string): Promise<TgResult>;
}

export function realBotApi(token: string): BotApi {
  return {
    send: (chatId, msg) => sendMessage(token, chatId, msg),
    async answerCallback(callbackId, text) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callback_query_id: callbackId, text }),
        });
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return interpretResponse(res.status, body);
      } catch (e) {
        return { ok: false, permanent: false, error: (e as Error).message };
      }
    },
  };
}

let testApi: BotApi | null = null;

// Действует только в тестовом окружении, чтобы боевой процесс нельзя было переключить на заглушку.
export function setTestBotApi(api: BotApi | null): void {
  if (process.env.PROJECT_PREFIX !== "managers_test_") return;
  testApi = api;
}

export function botApi(): BotApi | null {
  if (testApi) return testApi;
  const token = process.env.KPI_BOT_TOKEN;
  return token ? realBotApi(token) : null;
}
