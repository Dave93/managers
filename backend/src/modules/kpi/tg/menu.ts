// Кнопка меню чата «Мой KPI». У setChatMenuButton нет language_code, поэтому кнопка бота по умолчанию — русская,
// а чатам с узбекским языком ставится своя. Русский чат своей кнопки не держит: ему ставится default, и он следует
// за кнопкой бота. Иначе после смены KPI_MINIAPP_URL у него остался бы старый адрес. Смена языка переставляет кнопку чата.
import type { BotApi, MenuButton } from "./bot-api";
import type { Lang } from "./messages";
import { miniAppUrl } from "./miniapp-url";

export const MENU_TEXT: Record<Lang, string> = { ru: "Мой KPI", uz: "Mening KPI" };

export type MenuStep = { chatId: number | null; button: MenuButton };

const webApp = (lang: Lang, url: string): MenuButton => ({ type: "web_app", text: MENU_TEXT[lang], web_app: { url } });

// Кнопка одного чата: узбекскому своя, русскому default (за кнопкой бота).
function chatButton(lang: Lang, url: string): MenuButton {
  return lang === "uz" ? webApp("uz", url) : { type: "default" };
}

// Первой — кнопка бота по умолчанию (русская, без chat_id), затем узбекские чаты, затем русские; каждые по возрастанию,
// без повторов. Чат с привязками на обоих языках считается узбекским. default без chat_id стёр бы кнопку бота,
// поэтому он бывает только у конкретного чата.
export function menuPlan(rows: { telegram_id: number; lang: "ru" | "uz" }[], url: string): MenuStep[] {
  const uz = new Set(rows.filter((r) => r.lang === "uz").map((r) => r.telegram_id));
  const ru = new Set(rows.filter((r) => r.lang === "ru" && !uz.has(r.telegram_id)).map((r) => r.telegram_id));
  const asc = (s: Set<number>) => Array.from(s).sort((a, b) => a - b);
  return [
    { chatId: null, button: webApp("ru", url) },
    ...asc(uz).map((chatId) => ({ chatId, button: chatButton("uz", url) })),
    ...asc(ru).map((chatId) => ({ chatId, button: chatButton("ru", url) })),
  ];
}

// Неудача не бросает: язык уже сохранён, кнопка меню второстепенна. Токен в лог не попадает (realBotApi его скрывает).
// Без адреса приложения Telegram не зовётся ни для какого языка.
export async function syncMenuButton(api: BotApi | null, chatId: number, lang: Lang): Promise<void> {
  const url = miniAppUrl();
  if (!url || !api || !api.setMenuButton) return;
  try {
    const res = await api.setMenuButton(chatId, chatButton(lang, url));
    if (!res.ok) console.error(`kpi menu: setChatMenuButton не удался: ${res.error}`);
  } catch (e) {
    console.error(`kpi menu: setChatMenuButton не удался: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Шаги плана по очереди, чтобы не упереться в лимит Telegram. Каждая неудача печатается с причиной; токен вырезается
// и здесь, на случай если причина пришла мимо redact в realBotApi. Итог — одна строка; true, если встала кнопка по умолчанию.
export async function applyMenuPlan(
  api: BotApi,
  plan: MenuStep[],
  token: string,
  log: { info: (line: string) => void; error: (line: string) => void },
): Promise<boolean> {
  const redact = (s: string) => (token ? s.replaceAll(token, "***") : s);
  let defaultOk = false;
  const n = { uz: { ok: 0, all: 0 }, ru: { ok: 0, all: 0 } };
  for (const step of plan) {
    const kind = step.chatId === null ? null : step.button.type === "default" ? "ru" : "uz";
    let reason: string | null = null;
    try {
      if (!api.setMenuButton) reason = "setMenuButton не задан";
      else {
        const res = await api.setMenuButton(step.chatId, step.button);
        if (!res.ok) reason = res.error;
      }
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    if (kind === null) defaultOk = reason === null;
    else {
      n[kind].all++;
      if (reason === null) n[kind].ok++;
    }
    if (reason !== null) log.error(`kpi menu: ${kind === null ? "default" : `chat ${step.chatId} (${kind})`} fail: ${redact(reason)}`);
  }
  log.info(`kpi menu: default ${defaultOk ? "ok" : "fail"}, uz chats ${n.uz.ok}/${n.uz.all}, ru chats ${n.ru.ok}/${n.ru.all}`);
  return defaultOk;
}
