/** Функция перевода из useTranslations("stoplistPage"). */
export type StoplistT = (key: string, values?: Record<string, string | number>) => string;

export const HOUR = 3600;
export const DAY = 86400;

export type Tier = "fresh" | "stale" | "chronic";

// fresh: placed within the last 24h — today's work.
// stale: 1..30 days — needs a push, but not news.
// chronic: >30 days — background; shown collapsed.
export function tierOf(seconds: number): Tier {
  if (seconds >= 30 * DAY) return "chronic";
  if (seconds >= DAY) return "stale";
  return "fresh";
}

export function fmtDuration(t: StoplistT, totalSeconds: number): string {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(s / DAY);
  const hours = Math.floor((s % DAY) / HOUR);
  const minutes = Math.floor((s % HOUR) / 60);
  if (days >= 30) return t("duration.monthsDays", { months: Math.floor(days / 30), days: days % 30 });
  if (days > 0) return t("duration.daysHours", { days, hours });
  if (hours > 0) return t("duration.hoursMinutes", { hours, minutes });
  return t("duration.minutes", { minutes });
}

// Text colour by urgency. Only three steps so the eye can rank a column.
export function severityClass(seconds: number): string {
  if (seconds >= DAY) return "text-red-600 dark:text-red-400";
  if (seconds >= 2 * HOUR) return "text-amber-600 dark:text-amber-400";
  return "text-foreground";
}

export function severityDot(seconds: number): string {
  if (seconds >= DAY) return "bg-red-500";
  if (seconds >= 2 * HOUR) return "bg-amber-500";
  return "bg-emerald-500";
}

// "Hotlegs, 3 шт" / "Hotlegs, 10 шт" → "Hotlegs"; "Coca-Cola 0.5" stays.
// Variants of one product are one supply problem, so the board shows them
// as one line with a variant count.
export function normalizeProductName(name: string | null): string {
  if (!name) return "";
  return name
    .replace(/[,\s]+\d+\s*(шт|dona|pcs)\.?\s*$/iu, "")
    .replace(/\s+\(\s*\d+\s*(шт|dona|pcs)\s*\)\s*$/iu, "")
    .trim();
}

const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tashkent",
});
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tashkent",
});
// Название месяца зависит от языка интерфейса; для ru формат прежний.
const INTL_LOCALES: Record<string, string> = {
  ru: "ru-RU",
  en: "en-GB",
  "uz-Latn": "uz-Latn-UZ",
  "uz-Cyrl": "uz-Cyrl-UZ",
};
const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
function dateFmtFor(locale: string): Intl.DateTimeFormat {
  let f = dateFmtCache.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALES[locale] ?? "ru-RU", {
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Tashkent",
    });
    dateFmtCache.set(locale, f);
  }
  return f;
}

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtDate = (iso: string, locale = "ru") => dateFmtFor(locale).format(new Date(iso));

export function fmtAgo(t: StoplistT, iso: string | null, now = Date.now()): string {
  if (!iso) return t("ago.noData");
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return t("ago.justNow");
  if (s < HOUR) return t("ago.minutes", { count: Math.round(s / 60) });
  if (s < DAY) return t("ago.hours", { count: Math.round(s / HOUR) });
  return fmtDateTime(iso);
}

export const BRAND_LABEL: Record<string, string> = {
  les: "Les Ailes",
  chopar: "Chopar",
};

