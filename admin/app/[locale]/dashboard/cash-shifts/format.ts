import { useTranslations } from "next-intl";
import { toIntlLocale } from "../intl-locale";
import type { ShiftFlag } from "./flags";

const TZ = "Asia/Tashkent";

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });

// «DD.MM HH:MM» in Tashkent time, e.g. the moment of the last sync.
export function fmtDayMonthTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: TZ,
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

export const fmtDay = (day: string, locale: string) =>
  new Date(`${day}T12:00:00+05:00`).toLocaleDateString(toIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    weekday: "short",
    timeZone: TZ,
  });

type Translate = (key: string, values?: Record<string, string | number>) => string;

// `td` is a translator scoped to "dashboardUi.duration".
export function fmtDuration(fromIso: string, toIso: string | null, td: Translate, nowMs = Date.now()): string {
  const ms = (toIso ? Date.parse(toIso) : nowMs) - Date.parse(fromIso);
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? td("hoursMinutes", { hours: h, minutes: m }) : td("minutes", { minutes: m });
}

export const fmtMoney = (v: number, unit: string) =>
  `${Math.round(v).toLocaleString("ru-RU")} ${unit}`;

// Money formatter bound to the localized currency label (ru: "сум").
export const useFmtMoney = () => {
  const t = useTranslations("dashboardUi");
  return (v: number) => fmtMoney(v, t("currency"));
};

export const KNOWN_STATUSES = new Set(["OPEN", "CLOSED", "ACCEPTED", "UNACCEPTED", "HASWARNINGS"]);
