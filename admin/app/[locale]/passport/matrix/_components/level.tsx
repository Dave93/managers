"use client";

// The colour vocabulary of the matrix, in one file for the same reason the
// curriculum builder and the enrollments screen each keep their own
// (curriculum/_components/status.tsx, enrollments/_components/status.tsx):
// the grid, the legend and the journal must never disagree about what amber
// means.
//
// TWO INDEPENDENT CHANNELS, and keeping them independent is the whole design:
//
//   FILL  = how far the trainee got — the level of the WEAKEST active topic in
//           the module (`level_min`):
//             1 «увидел»  slate    — watched it happen
//             2 «сделал»  amber    — did it once; the next move is the mentor's
//             3 «сам»     emerald  — does it alone. This is the bar.
//             4 «учит»    violet   — teaches others. Above the bar.
//           `level_min === null` is NOT level 0: the module has no active
//           topics at all, so there is nothing to colour. It gets an empty
//           cell, never a grey chip that would read as "did nothing".
//
//   EDGE  = whether the module's own deadline has passed (`deadline_status`).
//           Red edge, amber edge for the last three days. A cell can be green
//           and red at once — «сделал вовремя» and «сделал в срок» are
//           different questions and the grid answers both without either
//           overwriting the other.
//
// The one honest complication, spelled out in the legend and again under the
// metrics strip: an ALREADY COMPLETE module whose date has passed still comes
// back `deadline_status: "overdue"` from the API, but is deliberately excluded
// from `totals.overdue_modules` — the counter counts what still needs chasing.
// Such a cell gets a DASHED red edge instead of a solid one, so the grid and
// the counter visibly disagree on purpose rather than looking broken.

import { Check } from "lucide-react";
import { cn } from "@admin/lib/utils";

export const LEVEL_LABEL: Record<number, string> = {
  1: "Увидел",
  2: "Сделал",
  3: "Сам",
  4: "Учит других",
};

const LEVEL_CHIP: Record<number, string> = {
  1: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300",
  2: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  3: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  4: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300",
};

/** Level 0 exists in the data (a topic nobody has opened) but has no label of
 *  its own in the design vocabulary — it is "не начато". */
const NOT_STARTED =
  "border-dashed border-border bg-transparent text-muted-foreground";

export function levelTitle(level: number | null): string {
  if (level === null) return "в модуле нет активных тем";
  if (level === 0) return "не начато";
  return `${level} — ${LEVEL_LABEL[level] ?? "неизвестный уровень"}`;
}

/**
 * The level pip. `level === null` renders nothing — the caller draws an empty
 * cell, because "no active topics" is a statement about the CURRICULUM, not
 * about the trainee.
 */
export function LevelChip({
  level,
  complete,
  className,
}: {
  level: number | null;
  complete?: boolean;
  className?: string;
}) {
  if (level === null) return null;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] min-w-[26px] items-center justify-center gap-0.5 rounded border px-1 text-[11.5px] font-semibold leading-none tabular-nums",
        level === 0 ? NOT_STARTED : LEVEL_CHIP[level] ?? NOT_STARTED,
        className
      )}
    >
      {complete && <Check className="size-3" aria-hidden />}
      {level === 0 ? "—" : level}
    </span>
  );
}

/**
 * The legend. Not decoration: without it the grid is four colours nobody can
 * name, and the two channels (fill = level, edge = deadline) are exactly the
 * kind of thing a reader invents a wrong theory about.
 */
export function MatrixLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-[11.5px] text-muted-foreground",
        className
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide">
        Уровень
      </span>
      {/* Level 0 — the trainee has active topics but has opened none of them.
          A DIFFERENT fact from "the module has no active topics" (level_min
          null) further down, and the two share a dashed outline, so both have
          to be named or the vocabulary is ambiguous. */}
      <span className="inline-flex items-center gap-1.5">
        <LevelChip level={0} />
        не начато
      </span>
      {[1, 2, 3, 4].map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <LevelChip level={l} />
          {LEVEL_LABEL[l]}
        </span>
      ))}

      <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />

      <span className="text-[10px] font-semibold uppercase tracking-wide">
        Дедлайн модуля
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block size-[18px] rounded border-2 border-red-400 bg-red-50 dark:bg-red-950/40"
          aria-hidden
        />
        просрочен
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block size-[18px] rounded border-2 border-dashed border-red-300"
          aria-hidden
        />
        просрочен, но модуль уже закрыт — догонять нечего
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block size-[18px] rounded border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30"
          aria-hidden
        />
        меньше 3 дней
      </span>

      <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />

      <span className="inline-flex items-center gap-1.5">
        <LevelChip level={3} complete />
        все темы модуля на «сам» и выше
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block size-[18px] rounded border border-dashed border-border"
          aria-hidden
        />
        в модуле нет активных тем
      </span>
    </div>
  );
}
