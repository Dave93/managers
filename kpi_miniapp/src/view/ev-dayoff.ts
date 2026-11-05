// Форма выдачи выходного как данные (без DOM): подписи, проверка заявки до отправки, тело запроса.
// Проверки дублируют серверные (days-off-rules.ts), чтобы кнопка не нажималась зря; сервер остаётся главным.
import type { DayOffReason, EvDayOffForm } from "@backend/modules/kpi/tg-app/ev-types";
import type { Key, Lang } from "../i18n";
import { tIn } from "../i18n";
import { reasonCount } from "../util";
import { dayLabel } from "./attendance";

export interface DayOffDraft { from: string; to: string; reason: DayOffReason | null; text: string }

// Минимум букв и цифр в тексте «другой» причины (как у сервера).
const TEXT_MIN = 3;

const REASON_KEY: Record<DayOffReason, Key> = {
  sick: "ev_reason_sick",
  family: "ev_reason_family",
  time_off: "ev_reason_time_off",
  vacation: "ev_reason_vacation",
  schedule: "ev_reason_schedule",
  other: "ev_reason_other",
};

/** Подпись причины на языке интерфейса. */
export const reasonLabel = (code: DayOffReason, l: Lang): string => tIn(l, REASON_KEY[code]);

const DAY_MS = 86_400_000;

/** Календарный день «YYYY-MM-DD» в миллисекундах UTC; не дата (в том числе 2025-02-30) — null. */
function dayMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
}

/** Число дней диапазона включительно; 0, если даты не заданы, неверны или «с» позже «по». */
export function dayOffCount(d: Pick<DayOffDraft, "from" | "to">): number {
  const a = dayMs(d.from);
  const b = dayMs(d.to);
  return a === null || b === null || b < a ? 0 : Math.round((b - a) / DAY_MS) + 1;
}

/** Замечания к заявке по порядку: даты, длина, окно, причина, текст. Пусто — можно отправлять. */
export function dayOffIssues(d: DayOffDraft, f: EvDayOffForm, l: Lang): string[] {
  const out: string[] = [];
  const n = dayOffCount(d);
  if (n === 0) out.push(tIn(l, "ev_dayoff_err_dates"));
  else if (n > f.max_range_days) out.push(tIn(l, "ev_dayoff_err_long", { n: f.max_range_days }));
  else if (d.from < f.window.min || d.to > f.window.max) {
    out.push(tIn(l, "ev_dayoff_err_window", { from: dayLabel(f.window.min, l), to: dayLabel(f.window.max, l) }));
  }
  if (d.reason === null) out.push(tIn(l, "ev_dayoff_err_reason"));
  else if (d.reason === "other" && reasonCount(d.text) < TEXT_MIN) out.push(tIn(l, "ev_dayoff_err_text", { min: TEXT_MIN }));
  return out;
}

/** Тело POST /ev/days-off: текст уходит только с причиной «другая». */
export function dayOffBody(
  employeeId: string,
  d: DayOffDraft & { reason: DayOffReason }
): { employee_id: string; from: string; to: string; reason_code: DayOffReason; reason_text?: string } {
  const body = { employee_id: employeeId, from: d.from, to: d.to, reason_code: d.reason };
  return d.reason === "other" ? { ...body, reason_text: d.text.trim() } : body;
}

export interface DayOffFormVM {
  title: string; name: string;
  reasons: { code: DayOffReason; label: string }[];
  min: string; max: string;
  existing: string; // «Уже выдано: 30 октября, 31 октября»; пусто, если выданных дней нет
}

export function dayOffFormView(f: EvDayOffForm, l: Lang): DayOffFormVM {
  const name = `${f.employee.last_name} ${f.employee.first_name}`.trim();
  return {
    title: tIn(l, "ev_dayoff_title", { name }),
    name,
    reasons: f.reasons.map((code) => ({ code, label: reasonLabel(code, l) })),
    min: f.window.min,
    max: f.window.max,
    existing: f.existing.length ? tIn(l, "ev_dayoff_existing", { days: f.existing.map((x) => dayLabel(x, l)).join(", ") }) : "",
  };
}
