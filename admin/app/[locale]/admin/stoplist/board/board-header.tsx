"use client";
import { Search, X } from "lucide-react";
import { Input } from "@admin/components/ui/input";
import { cn } from "@admin/lib/utils";
import { fmtAgo } from "./format";
import type { BoardKpi } from "./use-board";

type Props = {
  brand: string | null;
  onBrand: (b: string | null) => void;
  search: string;
  onSearch: (s: string) => void;
  kpi: BoardKpi | null;
  stats: { released_today: number; stops_today: number } | null;
  syncedAt: string | null;
  isFetching: boolean;
};

const BRANDS: { value: string | null; label: string }[] = [
  { value: null, label: "Оба бренда" },
  { value: "les", label: "Les Ailes" },
  { value: "chopar", label: "Chopar" },
];

function Stat({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone?: "red" | "amber" | "muted";
}) {
  return (
    <div className="flex flex-col leading-tight">
      <span
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "red" && "text-red-600 dark:text-red-400",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground"
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function BoardHeader({
  brand,
  onBrand,
  search,
  onSearch,
  kpi,
  stats,
  syncedAt,
  isFetching,
}: Props) {
  return (
    <div className="flex flex-col gap-3 border-b pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {BRANDS.map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={() => onBrand(b.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                brand === b.value
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Продукт или филиал"
            className="pl-8 pr-8"
          />
          {search && (
            <button
              type="button"
              aria-label="Очистить"
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="ml-auto text-xs text-muted-foreground" title={syncedAt ?? ""}>
          {isFetching ? "обновляем…" : `данные ${fmtAgo(syncedAt)}`}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat value={kpi?.fresh ?? "—"} label="свежих стопов (до 24 ч)" tone="amber" />
        <Stat value={kpi?.terminalsBurning ?? "—"} label="филиалов со свежими" />
        <Stat value={kpi?.stale ?? "—"} label="висят 1–30 дней" tone="red" />
        <Stat value={kpi?.chronic ?? "—"} label="хронических (>30 дней)" tone="muted" />
        <div className="hidden h-9 w-px bg-border sm:block" />
        <Stat value={stats?.stops_today ?? "—"} label="поставлено сегодня" />
        <Stat value={stats?.released_today ?? "—"} label="снято сегодня" />
      </div>
    </div>
  );
}
