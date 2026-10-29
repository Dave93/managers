// Переводы текстов lib/tickets-*. Функции, возвращающие текст, принимают последним параметром `t`
// (useTranslations("ticketsLib") в компоненте). Без `t` — русский запасной вариант.
import { createTranslator } from "next-intl";
import { RU_TICKETS_LIB } from "./tickets-ru";

export type TicketsLibT = (key: string, values?: Record<string, string | number>) => string;

/** Русский переводчик по умолчанию: тесты и вызовы без `t` получают прежние русские тексты. */
export const ruT: TicketsLibT = createTranslator({
  locale: "ru",
  messages: { ticketsLib: RU_TICKETS_LIB },
  namespace: "ticketsLib",
} as never) as unknown as TicketsLibT;
