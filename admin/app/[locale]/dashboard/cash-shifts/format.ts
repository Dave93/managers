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

// Russian plural: 1, 21 → one; 2–4, 22–24 → few; 0, 5–20, 11–14 → many.
export function plural(n: number, one: string, few: string, many: string): string {
  const n100 = Math.abs(Math.trunc(n)) % 100;
  const n10 = n100 % 10;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

export const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00+05:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    weekday: "short",
    timeZone: TZ,
  });

export function fmtDuration(fromIso: string, toIso: string | null, nowMs = Date.now()): string {
  const ms = (toIso ? Date.parse(toIso) : nowMs) - Date.parse(fromIso);
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export const fmtMoney = (v: number) =>
  `${Math.round(v).toLocaleString("ru-RU")} сум`;

export const FLAG_LABEL: Record<ShiftFlag, string> = {
  late_open: "позднее открытие",
  late_close: "позднее закрытие",
  too_long: "долгая смена",
  unclosed: "не закрыта на момент синхронизации",
};

export const STATUS_LABEL: Record<string, string> = {
  OPEN: "открыта",
  CLOSED: "закрыта",
  ACCEPTED: "принята",
  UNACCEPTED: "не принята",
  HASWARNINGS: "подозрительная",
};
