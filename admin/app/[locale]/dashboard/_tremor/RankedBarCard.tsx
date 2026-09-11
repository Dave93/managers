"use client";

import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent } from "@admin/components/ui/card";
import type { OrgOption } from "./KpiAreaCard";

export type BranchRow = { name: string; current: number; previous: number | null };

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
  const sorted = React.useMemo(
    () => [...rows].sort((a, b) => b.current - a.current),
    [rows]
  );
  const max = sorted[0]?.current || 1;

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

        <div className="min-h-0 grow space-y-1 overflow-y-auto pr-1">
          {sorted.map((r, i) => (
            <div key={r.name} className="flex items-center gap-2 py-1">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
              <span className="w-28 shrink-0 truncate text-sm sm:w-36" title={r.name}>{r.name}</span>
              <div className="relative h-5 grow overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-emerald-600"
                  style={{ width: `${Math.max(2, (r.current / max) * 100)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-bold tabular-nums">{formatValue(r.current)}</span>
              <span className="w-12 shrink-0 text-right">
                <DeltaChip current={r.current} previous={r.previous} />
              </span>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">Нет данных</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
