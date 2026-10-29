// Разбор апдейта Telegram и проверка секрета вебхука. Чистые функции.
import { timingSafeEqual } from "node:crypto";

export type CallbackAction =
  | { kind: "lang"; lang: "ru" | "uz" }
  | { kind: "dispute"; subject_type: "review" | "violation"; subject_id: string }
  | { kind: "unknown" };

export type BotUpdate =
  | { type: "start"; chatId: number; fromId: number; token: string | null; hasPayload: boolean }
  | { type: "my"; chatId: number; fromId: number }
  | { type: "help"; chatId: number; fromId: number }
  | { type: "text"; chatId: number; fromId: number; text: string }
  | { type: "callback"; chatId: number; fromId: number; callbackId: string; action: CallbackAction }
  | { type: "ignore" };

const IGNORE: BotUpdate = { type: "ignore" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^kpi_[0-9a-f]{32}$/;
const COMMAND_RE = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseCallbackData(data: unknown): CallbackAction {
  if (typeof data !== "string") return { kind: "unknown" };
  if (data === "lang:ru") return { kind: "lang", lang: "ru" };
  if (data === "lang:uz") return { kind: "lang", lang: "uz" };
  const m = /^dispute:(review|violation):(.+)$/.exec(data);
  if (m && UUID_RE.test(m[2])) {
    return { kind: "dispute", subject_type: m[1] as "review" | "violation", subject_id: m[2].toLowerCase() };
  }
  return { kind: "unknown" };
}

export function parseUpdate(body: unknown): BotUpdate {
  if (!isObj(body)) return IGNORE;

  if (isObj(body.message)) {
    const m = body.message;
    const chat = m.chat;
    const from = m.from;
    if (!isObj(chat) || !isObj(from)) return IGNORE;
    if (chat.type !== "private" || from.is_bot === true) return IGNORE;
    if (!isNum(chat.id) || !isNum(from.id)) return IGNORE;
    if (typeof m.text !== "string") return IGNORE;
    const ids = { chatId: chat.id, fromId: from.id };
    const text = m.text.trim();
    if (text.startsWith("/")) {
      const c = COMMAND_RE.exec(text);
      const cmd = c ? c[1].toLowerCase() : "";
      if (cmd === "start") {
        const arg = (c?.[2] ?? "").trim();
        if (arg === "") return { type: "start", ...ids, token: null, hasPayload: false };
        return { type: "start", ...ids, token: TOKEN_RE.test(arg) ? arg.slice(4) : null, hasPayload: true };
      }
      if (cmd === "my") return { type: "my", ...ids };
      return { type: "help", ...ids };
    }
    return { type: "text", ...ids, text };
  }

  if (isObj(body.callback_query)) {
    const q = body.callback_query;
    const from = q.from;
    const chat = isObj(q.message) ? q.message.chat : undefined;
    if (!isObj(chat) || !isObj(from)) return IGNORE;
    if (chat.type !== "private" || from.is_bot === true) return IGNORE;
    if (!isNum(chat.id) || !isNum(from.id)) return IGNORE;
    if (typeof q.id !== "string" || q.id === "") return IGNORE;
    return {
      type: "callback",
      chatId: chat.id,
      fromId: from.id,
      callbackId: q.id,
      action: parseCallbackData(q.data),
    };
  }

  return IGNORE;
}

// Равенство секрета за постоянное время; разная длина — сразу false.
export function secretOk(received: unknown, expected: string): boolean {
  if (typeof received !== "string" || typeof expected !== "string" || expected === "") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
