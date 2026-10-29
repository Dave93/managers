// Maps an app locale (next-intl) to an Intl/BCP-47 locale for weekday / month names.
// Russian keeps "ru-RU" so the Russian UI output is unchanged.
export const toIntlLocale = (locale: string): string => {
  if (locale === "uz-Latn") return "uz";
  if (locale === "uz-Cyrl") return "uz-Cyrl";
  if (locale === "en") return "en-GB";
  return "ru-RU";
};
