// Клиент Bot API. Тесты подменяют его через setTestBotApi: в тестах реальный Telegram не вызывается.
import { interpretResponse, sendMessage, type TgResult } from "@backend/modules/tickets/telegram";
import type { OutMessage } from "./messages";

export type { TgResult };

// MenuButton Telegram как есть: web_app — кнопка «Мой KPI», default — чат следует за кнопкой бота по умолчанию.
export type MenuButton = { type: "default" } | { type: "web_app"; text: string; web_app: { url: string } };

export interface BotApi {
  send(chatId: number, msg: OutMessage): Promise<TgResult>;
  answerCallback(callbackId: string, text?: string): Promise<TgResult>;
  // Кнопка меню: chatId = null — кнопка бота по умолчанию для всех, иначе — кнопка одного чата.
  // Необязательный метод: подмены в тестах его не задают.
  setMenuButton?(chatId: number | null, button: MenuButton): Promise<TgResult>;
}

export const BOT_API_TIMEOUT_MS = 10_000;

// Зависший Telegram не должен держать воркер или вебхук: по таймауту ответ временный, очередь повторит.
// Токен в тексте ошибки (fetch кладёт URL в сообщение) заменяется, чтобы не попасть в last_error и логи.
export function realBotApi(token: string, timeoutMs: number = BOT_API_TIMEOUT_MS): BotApi {
  const redact = (r: TgResult): TgResult => (r.ok ? r : { ...r, error: r.error.replaceAll(token, "***") });
  return {
    async send(chatId, msg) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<TgResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, permanent: false, error: "timeout" }), timeoutMs);
      });
      try {
        // sendMessage из tickets не принимает signal: запрос на таймауте остаётся висеть, но мы его уже не ждём.
        return redact(await Promise.race([sendMessage(token, chatId, msg), timeout]));
      } catch (e) {
        return redact({ ok: false, permanent: false, error: (e as Error).message });
      } finally {
        clearTimeout(timer);
      }
    },
    async answerCallback(callbackId, text) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ callback_query_id: callbackId, text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return redact(interpretResponse(res.status, body));
      } catch (e) {
        return redact({ ok: false, permanent: false, error: (e as Error).message });
      }
    },
    async setMenuButton(chatId, button) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(chatId === null ? {} : { chat_id: chatId }),
            menu_button: button,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        let body: any = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return redact(interpretResponse(res.status, body));
      } catch (e) {
        return redact({ ok: false, permanent: false, error: (e as Error).message });
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
