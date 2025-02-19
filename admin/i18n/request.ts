import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";


export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment
  let locale = await requestLocale;

  // Ensure that a valid locale is used
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }
  console.log(locale);
  return {
    formats: {
      dateTime: {
        medium: {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        },
        long: {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
    },
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
