// Переводы текстов lib/kpi. Функции, возвращающие текст, принимают последним параметром `t`
// (useTranslations("kpi") в компоненте, ключи вида "lib.errors.forbidden"). Без `t` — русский запасной вариант.
import { createTranslator } from "next-intl";
import { RU_LIB } from "./ru";

export type KpiT = (key: string, values?: Record<string, string | number>) => string;

/** Русский переводчик по умолчанию: тесты и вызовы без `t` получают прежние русские тексты. */
export const ruT: KpiT = createTranslator({
  locale: "ru",
  messages: { kpi: { lib: RU_LIB } },
  namespace: "kpi",
} as never) as unknown as KpiT;
