// Кнопка меню чата «Мой KPI». У setChatMenuButton нет language_code, поэтому всем ставится кнопка по умолчанию
// (русская), а чатам с узбекским языком — своя. Смена языка переставляет кнопку чата.
import type { BotApi } from "./bot-api";
import type { Lang } from "./messages";
import { miniAppUrl } from "./miniapp-url";

export const MENU_TEXT: Record<Lang, string> = { ru: "Мой KPI", uz: "Mening KPI" };

// Первой — кнопка по умолчанию, затем по одной на каждый узбекский telegram_id (без повторов, по возрастанию).
export function menuPlan(rows: { telegram_id: number; lang: "ru" | "uz" }[]): { chatId: number | null; text: string }[] {
  const uz = Array.from(new Set(rows.filter((r) => r.lang === "uz").map((r) => r.telegram_id))).sort((a, b) => a - b);
  return [{ chatId: null, text: MENU_TEXT.ru }, ...uz.map((chatId) => ({ chatId, text: MENU_TEXT.uz }))];
}

// Неудача не бросает: язык уже сохранён, кнопка меню второстепенна. Токен в лог не попадает (realBotApi его скрывает).
export async function syncMenuButton(api: BotApi | null, chatId: number, lang: Lang): Promise<void> {
  const url = miniAppUrl();
  if (!url || !api || !api.setMenuButton) return;
  try {
    const res = await api.setMenuButton(chatId, MENU_TEXT[lang], url);
    if (!res.ok) console.error(`kpi menu: setChatMenuButton не удался: ${res.error}`);
  } catch (e) {
    console.error(`kpi menu: setChatMenuButton не удался: ${e instanceof Error ? e.message : String(e)}`);
  }
}
