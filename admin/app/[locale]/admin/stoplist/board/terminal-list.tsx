"use client";
import { cn } from "@admin/lib/utils";
import { Skeleton } from "@admin/components/ui/skeleton";
import { BRAND_LABEL, fmtDuration, severityDot } from "./format";
import type { TerminalGroup } from "./use-board";

type Props = {
  terminals: TerminalGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  showBrand: boolean;
  isLoading: boolean;
};

export function TerminalList({ terminals, selectedKey, onSelect, showBrand, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-1 p-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }
  if (terminals.length === 0) {
    return (
      <div className="px-3 py-10 text-center text-sm text-muted-foreground">
        Ни одного филиала со стопами
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {terminals.map((t) => {
        const active = t.key === selectedKey;
        const burning = t.freshCount > 0;
        return (
          <li key={t.key}>
            <button
              type="button"
              onClick={() => onSelect(t.key)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                active ? "bg-primary/10" : "hover:bg-muted/60"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  burning ? severityDot(t.maxFreshSeconds) : "bg-muted-foreground/30"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {showBrand && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {BRAND_LABEL[t.brand] ?? t.brand}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {burning
                    ? `самый долгий свежий ${fmtDuration(t.maxFreshSeconds)}`
                    : t.staleCount > 0
                      ? `${t.staleCount} висят давно`
                      : `${t.chronicCount} хронических`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    burning ? "text-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {t.freshCount}
                </span>
                {(t.staleCount > 0 || t.chronicCount > 0) && (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    +{t.staleCount + t.chronicCount}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
