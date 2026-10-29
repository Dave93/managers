import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { ru } from "date-fns/locale/ru";
import { uz } from "date-fns/locale/uz";
import { uzCyrl } from "date-fns/locale/uz-Cyrl";

// next-intl locale code -> date-fns locale (month/weekday names in calendars).
const DATE_FNS_LOCALES: Record<string, Locale> = {
  ru,
  en: enUS,
  "uz-Latn": uz,
  "uz-Cyrl": uzCyrl,
};

export function getDateFnsLocale(locale: string): Locale {
  return DATE_FNS_LOCALES[locale] ?? ru;
}
