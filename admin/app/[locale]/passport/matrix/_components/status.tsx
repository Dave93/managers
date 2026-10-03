"use client";

// The enrollment-status chip, in the same palette the enrollments screen and
// the curriculum builder already use (enrollments/_components/status.tsx,
// curriculum/_components/status.tsx):
//
//   emerald  — идёт
//   amber    — на паузе (a human still has to do something)
//   slate    — завершена, история
//   red      — не пройдена
//
// A local copy rather than a cross-screen import, following the same rule the
// other two follow: each screen owns its vocabulary file, so one screen's
// refactor cannot silently repaint another's.

import { cn } from "@admin/lib/utils";
import type { PassportEnrollmentStatus } from "@admin/lib/passport-api";

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
        "inline-flex shrink-0 items-center gap-1 rounded border px-1 py-px text-[10px] font-medium whitespace-nowrap",
        CHIP[status],
        className
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden />
      {ENROLLMENT_STATUS_LABEL[status]}
    </span>
  );
}
