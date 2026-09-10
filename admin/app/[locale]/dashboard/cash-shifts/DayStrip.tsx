"use client";
import { AlertTriangle } from "lucide-react";
import { cn } from "@admin/lib/utils";
import { fmtDay } from "./format";

export type DaySummary = { day: string; shifts: number; flagged: number };

export default function DayStrip({
  days,
  active,
  onSelect,
}: {
  days: DaySummary[];
  active: string | null;
  onSelect: (day: string) => void;
}) {
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">Смен за период нет.</p>;
  }
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
      {days.map((d) => (
        <button
          key={d.day}
          type="button"
          onClick={() => onSelect(d.day)}
          aria-pressed={d.day === active}
          className={cn(
            "min-w-[7.5rem] shrink-0 rounded-lg border px-3 py-2 text-left transition-colors",
            d.day === active ? "border-primary bg-primary/10" : "hover:bg-muted"
          )}
        >
          <div className="text-xs text-muted-foreground">{fmtDay(d.day)}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums">{d.shifts} смен</div>
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1 text-xs tabular-nums",
              d.flagged > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
            )}
          >
            {d.flagged > 0 && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
            {d.flagged > 0 ? `${d.flagged} наруш.` : "без нарушений"}
          </div>
        </button>
      ))}
    </div>
  );
}
