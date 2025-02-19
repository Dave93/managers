import { createNavigation } from 'next-intl/navigation';
import { LocalePrefixMode } from 'next-intl/dist/types/src/routing/types';

export const routing = {
  // A list of all locales that are supported
  locales: ["en", "ru", "uz-Latn", "uz-Cyrl"],
  // Used when no locale matches
  defaultLocale: "ru",
  localePrefix: "always",
  // Disable automatic locale detection
  localeDetection: false
};

// Create localized pathname patterns
export const { Link, redirect, usePathname, useRouter } = createNavigation({
  locales: routing.locales,
  localePrefix: routing.localePrefix as LocalePrefixMode
});
