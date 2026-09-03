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

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(s / DAY);
  const hours = Math.floor((s % DAY) / HOUR);
  const minutes = Math.floor((s % HOUR) / 60);
  if (days >= 30) return `${Math.floor(days / 30)} мес ${days % 30} д`;
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
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
const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Tashkent",
});

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const fmtDate = (iso: string) => dateFmt.format(new Date(iso));

export function fmtAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "нет данных";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 90) return "только что";
  if (s < HOUR) return `${Math.round(s / 60)} мин назад`;
  if (s < DAY) return `${Math.round(s / HOUR)} ч назад`;
  return fmtDateTime(iso);
}

export const BRAND_LABEL: Record<string, string> = {
  les: "Les Ailes",
  chopar: "Chopar",
};

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
export const positionsWord = (n: number) => plural(n, "позиция", "позиции", "позиций");
export const terminalsWord = (n: number) => plural(n, "филиал", "филиала", "филиалов");
