export type MedicalStatus = "unfit" | "overdue" | "due_soon" | "ok" | "none";

export const DUE_SOON_DAYS = 30;

export const STATUS_RANK: Record<MedicalStatus, number> = {
  unfit: 0,
  overdue: 1,
  due_soon: 2,
  ok: 3,
  none: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-08-31" + 6 -> "2027-02-28": day-of-month clamps to the target month's end.
export function addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12; // 0-based month
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((Date.parse(dateIso) - Date.parse(todayIso)) / DAY_MS);
}

export function computeStatus(args: {
  lastResult: string | null;
  openDueDate: string | null;
  todayIso: string;
}): MedicalStatus {
  if (args.lastResult === "unfit") return "unfit";
  if (!args.openDueDate) return "none";
  const days = daysUntil(args.openDueDate, args.todayIso);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

export function projectFutureDates(
  fromIso: string,
  intervalMonths: number,
  years = 5
): string[] {
  const out: string[] = [];
  const count = Math.floor((years * 12) / intervalMonths);
  for (let i = 1; i <= count; i++) out.push(addMonthsClamped(fromIso, intervalMonths * i));
  return out;
}
