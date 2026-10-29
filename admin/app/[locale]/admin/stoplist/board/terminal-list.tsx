"use client";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("stoplistPage");
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
        {t("board.noTerminals")}
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {terminals.map((tm) => {
        const active = tm.key === selectedKey;
        const burning = tm.freshCount > 0;
        return (
          <li key={tm.key}>
            <button
              type="button"
              onClick={() => onSelect(tm.key)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                active ? "bg-primary/10" : "hover:bg-muted/60"
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  burning ? severityDot(tm.maxFreshSeconds) : "bg-muted-foreground/30"
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{tm.name}</span>
                  {showBrand && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {BRAND_LABEL[tm.brand] ?? tm.brand}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {burning
                    ? t("board.longestFresh", { duration: fmtDuration(t, tm.maxFreshSeconds) })
                    : tm.staleCount > 0
                      ? t("board.staleCount", { count: tm.staleCount })
                      : t("board.chronicCount", { count: tm.chronicCount })}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    burning ? "text-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {tm.freshCount}
                </span>
                {(tm.staleCount > 0 || tm.chronicCount > 0) && (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    +{tm.staleCount + tm.chronicCount}
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
