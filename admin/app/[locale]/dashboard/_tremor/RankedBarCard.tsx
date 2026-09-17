"use client";

import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent } from "@admin/components/ui/card";
import { cn } from "@admin/lib/utils";
import type { OrgOption } from "./KpiAreaCard";

export type BranchRow = {
  name: string;
  current: number | null;
  previous: number | null;
  /** 1-based position across the ranked set (franchise-network ranking only). */
  rank?: number;
  /** row belongs to the viewer; other branches are masked when this is false. */
  own?: boolean;
};

type Props = {
  title: string;
  rows: BranchRow[];
  formatValue: (n: number) => string;
  /** Optional subtitle / metric line under the title. */
  subtitle?: React.ReactNode;
  /** Extra header controls (right side, before the org toggle). */
  headerRight?: React.ReactNode;
  organization?: string | null;
  orgOptions?: OrgOption[];
  onOrganizationChange?: (id: string) => void;
};

const DeltaChip = ({ current, previous }: { current: number; previous: number | null | undefined }) => {
  if (previous == null) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground dark:bg-slate-800">
        новый
      </span>
    );
  }
  const pct = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  if (Math.abs(pct) < 0.5) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground dark:bg-slate-800">
        0%
      </span>
    );
  }
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
        up ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950" : "bg-red-100 text-red-500 dark:bg-red-950"
      }`}
    >
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
};

// A row is masked when it belongs to another branch in a franchise-network
// ranking: rank + name only, no bar, no value, no delta.
const isMaskedRow = (r: BranchRow) => r.current == null && r.own === false;

export default function RankedBarCard({
  title,
  rows,
  formatValue,
  subtitle,
  headerRight,
  organization,
  orgOptions,
  onOrganizationChange,
}: Props) {
  const sorted = React.useMemo(() => {
    const allRanked = rows.length > 0 && rows.every((r) => r.rank != null);
    if (allRanked) {
      return [...rows].sort((a, b) => (a.rank as number) - (b.rank as number));
    }
    return [...rows].sort((a, b) => (b.current ?? -Infinity) - (a.current ?? -Infinity));
  }, [rows]);

  const hasMasked = React.useMemo(() => sorted.some(isMaskedRow), [sorted]);

  const max = React.useMemo(() => {
    const values = sorted
      .filter((r) => !isMaskedRow(r))
      .map((r) => r.current)
      .filter((v): v is number => v != null);
    return values.length ? Math.max(...values) : 1;
  }, [sorted]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  React.useEffect(() => {
    if (!hasMasked) return;
    const container = containerRef.current;
    if (!container) return;
    const ownIndex = sorted.findIndex((r) => r.own === true);
    const el = ownIndex >= 0 ? rowRefs.current[ownIndex] : null;
    if (!el) return;
    const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex min-h-0 grow flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          {(headerRight || (orgOptions && orgOptions.length > 0 && onOrganizationChange)) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {headerRight}
              {orgOptions && orgOptions.length > 0 && onOrganizationChange && (
                <div className="inline-flex shrink-0 overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    data-active={!organization}
                    onClick={() => onOrganizationChange("")}
                    className="px-3 py-1.5 text-xs font-medium text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
                  >
                    Все
                  </button>
                  {orgOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      data-active={organization === o.id}
                      onClick={() => onOrganizationChange(o.id)}
                      className="border-l px-3 py-1.5 text-xs font-medium text-muted-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={containerRef} className="min-h-0 grow space-y-1 overflow-y-auto pr-1">
          {sorted.map((r, i) => {
            const rank = r.rank ?? i + 1;
            const key = `${r.rank ?? i}-${r.name}`;

            if (isMaskedRow(r)) {
              return (
                <div key={key} className="flex items-center gap-2 py-1 text-muted-foreground">
                  <span className="w-5 shrink-0 text-right text-xs font-bold">{rank}</span>
                  <span className="min-w-0 grow truncate text-sm" title={r.name}>
                    {r.name}
                  </span>
                </div>
              );
            }

            const highlightOwn = hasMasked && r.own === true;
            return (
              <div
                key={key}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={cn(
                  "flex items-center gap-2 py-1",
                  highlightOwn && "rounded bg-emerald-50 font-semibold dark:bg-emerald-950/40"
                )}
              >
                <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{rank}</span>
                <span className="w-28 shrink-0 truncate text-sm sm:w-36" title={r.name}>
                  {r.name}
                </span>
                <div className="relative h-5 grow overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-emerald-600"
                    style={{ width: `${Math.max(2, ((r.current ?? 0) / max) * 100)}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-bold tabular-nums">
                  {r.current != null ? formatValue(r.current) : "—"}
                </span>
                <span className="w-12 shrink-0 text-right">
                  <DeltaChip current={r.current ?? 0} previous={r.previous} />
                </span>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Нет данных</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
