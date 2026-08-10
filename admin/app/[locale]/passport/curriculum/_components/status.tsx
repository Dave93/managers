"use client";

// The colour vocabulary of the builder, in one place so the tree, the header
// and the readiness panel can never disagree about what amber means.
//
//   draft        neutral  — nobody is looking at it yet
//   review       amber    — waiting on someone
//   published    emerald  — live, frozen
//   deactivated  muted + struck through — retired, still in the history
//
// Amber is also the colour of "an unfilled language pair", which is deliberate:
// both amber states mean "a human still has to do something here", and the two
// never appear on the same row (a published module has no unfilled pairs).

import { cn } from "@admin/lib/utils";
import type { PassportModuleStatus } from "@admin/lib/passport-api";

export const MODULE_STATUS_LABEL: Record<PassportModuleStatus, string> = {
  draft: "Черновик",
  review: "На проверке",
  published: "Опубликован",
};

const DOT: Record<PassportModuleStatus, string> = {
  draft: "bg-slate-400 dark:bg-slate-500",
  review: "bg-amber-500",
  published: "bg-emerald-500",
};

const CHIP: Record<PassportModuleStatus, string> = {
  draft:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  review:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  published:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function StatusDot({
  status,
  active = true,
  className,
}: {
  status: PassportModuleStatus;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full transition-colors",
        active ? DOT[status] : "bg-muted-foreground/30",
        className
      )}
    />
  );
}

export function StatusChip({
  status,
  active = true,
  className,
}: {
  status: PassportModuleStatus;
  active?: boolean;
  className?: string;
}) {
  if (!active)
    return (
      <span
        className={cn(
          "inline-flex items-center rounded border border-dashed border-border px-1.5 py-px text-[11px] font-medium text-muted-foreground",
          className
        )}
      >
        Снят с обращения
      </span>
    );
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[11px] font-medium",
        CHIP[status],
        className
      )}
    >
      {MODULE_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The bilingual completeness signal, and the reason this screen exists: an
 * unfilled RU/UZ pair is what will refuse publication, so it has to be legible
 * from the tree without opening anything.
 *
 * Rendered ONLY when something is missing — a fully translated tree stays
 * quiet, so every amber pip on screen is a real to-do. `count` is how many of
 * the four pairs are missing that side.
 */
export function LangPips({
  ru,
  uz,
  className,
}: {
  ru: number;
  uz: number;
  className?: string;
}) {
  if (ru === 0 && uz === 0) return null;
  const pip = (label: string, missing: number) => (
    <span
      key={label}
      title={
        missing
          ? `${label}: не заполнено полей — ${missing}`
          : `${label}: заполнено`
      }
      className={cn(
        "inline-flex h-[15px] items-center px-1 text-[9px] font-semibold leading-none tracking-wide",
        missing
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
          : "bg-muted text-muted-foreground/60"
      )}
    >
      {label}
    </span>
  );
  return (
    <span
      className={cn(
        "inline-flex overflow-hidden rounded-[3px] border border-amber-200 dark:border-amber-900/60",
        className
      )}
    >
      {pip("RU", ru)}
      {pip("UZ", uz)}
    </span>
  );
}
