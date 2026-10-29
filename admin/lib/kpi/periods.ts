// Месяцы и кварталы KPI по Asia/Tashkent (UTC+5 круглый год). Период — всегда "YYYY-MM-01".
// Считаем сдвигом +5 ч и Date.UTC, без Intl: зона браузера не должна влиять на результат.
import { periodLabel } from "@admin/lib/inventory/periods";
import { ruT, type KpiT } from "./i18n";

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const ROMAN = ["I", "II", "III", "IV"];

function parts(p: string): [number, number] {
  const [y, m] = p.split("-").map(Number);
  return [y, m];
}

function ym(y: number, m: number): string {
  return `${y}-${pad(m)}-01`;
}

export function calendarPeriod(now: Date): string {
  const t = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return ym(t.getUTCFullYear(), t.getUTCMonth() + 1);
}

export function addMonths(p: string, n: number): string {
  const [y, m] = parts(p);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function periodOptions(now: Date, n: number): string[] {
  const cur = calendarPeriod(now);
  return Array.from({ length: n }, (_, i) => addMonths(cur, -i));
}

export function monthLabel(p: string, locale = "ru"): string {
  return periodLabel(p, locale).replace(/\s*г\.$/, "");
}

export function quarterOf(p: string): string {
  const [y, m] = parts(p);
  return ym(y, Math.floor((m - 1) / 3) * 3 + 1);
}

export function quarterOptions(now: Date, n: number): string[] {
  const cur = quarterOf(calendarPeriod(now));
  return Array.from({ length: n }, (_, i) => addMonths(cur, -3 * i));
}

export function defaultQuarter(now: Date): string {
  return quarterOf(addMonths(calendarPeriod(now), -3));
}

export function quarterLabel(q: string, t: KpiT = ruT): string {
  const [y, m] = parts(q);
  const n = Math.floor((m - 1) / 3);
  return t("lib.period.quarter", { roman: ROMAN[n], n: n + 1, year: y });
}

export function quarterMonths(q: string): [string, string, string] {
  return [q, addMonths(q, 1), addMonths(q, 2)];
}

export function raisesCsvFilename(q: string): string {
  const [y, m] = parts(q);
  return `kpi-raises-${y}-Q${Math.floor((m - 1) / 3) + 1}.csv`;
}

export function submitOpen(now: Date, d: { submit_opens_at: string }): boolean {
  return now.getTime() >= new Date(d.submit_opens_at).getTime();
}
