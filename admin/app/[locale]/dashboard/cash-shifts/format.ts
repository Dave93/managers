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
  unclosed: "не закрыта",
};
