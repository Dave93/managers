"use client";

// The colour vocabulary of the enrollments screen, kept in one file for the
// same reason the curriculum builder keeps its own
// (app/[locale]/passport/curriculum/_components/status.tsx): the table, the
// journal and the confirmations must never disagree about what amber means.
//
// It is deliberately the SAME palette as the builder's:
//   emerald  — done / passed / live-and-on-time
//   amber    — a human still has to do something (deadline within 3 days,
//              enrollment paused)
//   slate    — neutral, nothing is being asked of anyone
//   red      — overdue, or a failed outcome
//
// Red appears on this screen only for a real failure: an overdue probation
// deadline on a LIVE enrollment, or a "не пройдена" outcome. A completed
// enrollment whose deadline happens to be in the past is not red — the
// deadline stopped mattering the moment it closed, and painting history red
// trains people to ignore the colour.

import { cn } from "@admin/lib/utils";
import type { PassportEnrollmentStatus } from "@admin/lib/passport-api";
import type { DeadlineInfo } from "./use-enrollments";

export const ENROLLMENT_STATUS_LABEL: Record<PassportEnrollmentStatus, string> =
  {
    active: "Идёт",
    paused: "На паузе",
    completed: "Завершена",
    failed: "Не пройдена",
  };

const CHIP: Record<PassportEnrollmentStatus, string> = {
  active:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  paused:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  completed:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  failed:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
};

const DOT: Record<PassportEnrollmentStatus, string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  completed: "bg-slate-400 dark:bg-slate-500",
  failed: "bg-red-500",
};

export function EnrollmentStatusChip({
  status,
  className,
}: {
  status: PassportEnrollmentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-px text-[11px] font-medium whitespace-nowrap",
        CHIP[status],
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {ENROLLMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function isLive(status: PassportEnrollmentStatus): boolean {
  return status === "active" || status === "paused";
}

/**
 * The probation deadline with its remaining-days pill.
 *
 * `live=false` (a closed enrollment) drops the colour entirely: the date stays
 * as the record of what the deadline was, without pretending anyone still has
 * to act on it.
 */
export function DeadlineCell({
  info,
  date,
  live,
}: {
  info: DeadlineInfo | null;
  date: string;
  live: boolean;
}) {
  if (!info)
    return (
      <span className="text-[12px] text-muted-foreground">без дедлайна</span>
    );

  if (!live)
    return (
      <span className="text-[12.5px] tabular-nums text-muted-foreground">
        {date}
      </span>
    );

  const pill =
    info.tone === "overdue"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
      : info.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-transparent bg-transparent text-muted-foreground";

  const left =
    info.tone === "overdue"
      ? `просрочено на ${plural(Math.abs(info.days), "день", "дня", "дней")}`
      : info.days <= 0
        ? "сегодня"
        : `${plural(info.days, "день", "дня", "дней")}`;

  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={cn(
          "text-[12.5px] tabular-nums",
          info.tone === "overdue" &&
            "font-semibold text-red-700 dark:text-red-300"
        )}
      >
        {date}
      </span>
      <span
        className={cn(
          "inline-flex w-fit items-center rounded border px-1 py-px text-[10.5px] leading-none",
          pill
        )}
      >
        {left}
      </span>
    </span>
  );
}

export function plural(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} ${many}`;
  if (last > 1 && last < 5) return `${n} ${few}`;
  if (last === 1) return `${n} ${one}`;
  return `${n} ${many}`;
}
