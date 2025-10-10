import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ["en", "ru", "uz-Latn", "uz-Cyrl"],
  // Used when no locale matches
  defaultLocale: "ru",
  localePrefix: "always",
  // Disable automatic locale detection
  localeDetection: false
});

// Create localized pathname patterns
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
