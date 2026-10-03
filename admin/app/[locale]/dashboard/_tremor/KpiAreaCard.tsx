"use client";

import React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent } from "@admin/components/ui/card";
import { cn } from "@admin/lib/utils";

export type KpiPoint = { date: string; current: number; previous: number | null };

export type OrgOption = { id: string; label: string };

export type IntervalOption = { value: string; label: string };

type Props = {
  title: string;
  current: number;
  previous: number;
  data: KpiPoint[];
  /** Format the big number / axis / tooltip values. */
  formatValue: (n: number) => string;
  /** Compact axis label formatter (defaults to formatValue). */
  formatAxis?: (n: number) => string;
  /** X-axis tick formatter (date → label). */
  formatDate?: (d: string) => string;
  currentLabel: string;
  previousLabel: string;
  /** Period interval tabs. Omit to hide. */
  interval?: string;
  intervals?: IntervalOption[];
  onIntervalChange?: (v: string) => void;
  /** Org segmented toggle. Omit to hide. */
  organization?: string | null;
  orgOptions?: OrgOption[];
  onOrganizationChange?: (id: string) => void;
  /** Slot for extra controls on the footer right (e.g. zoom reset). */
  footerRight?: React.ReactNode;
};

const COLOR_CURRENT = "#16a34a";
const COLOR_PREVIOUS = "#94a3b8";

function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  formatDate,
  currentLabel,
  previousLabel,
}: any) {
  if (!active || !payload?.length) return null;
  const cur = payload.find((p: any) => p.dataKey === "current")?.value ?? 0;
  const prevP = payload.find((p: any) => p.dataKey === "previous");
  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-lg">
      <div className="mb-1 font-medium">{formatDate ? formatDate(label) : label}</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_CURRENT }} />
        {currentLabel}: <span className="font-semibold">{formatValue(cur)}</span>
      </div>
      {prevP && prevP.value != null && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_PREVIOUS }} />
          {previousLabel}: <span className="font-medium">{formatValue(prevP.value)}</span>
        </div>
      )}
    </div>
  );
}

export default function KpiAreaCard({
  title,
  current,
  previous,
  data,
  formatValue,
  formatAxis,
  formatDate,
  currentLabel,
  previousLabel,
  interval,
  intervals,
  onIntervalChange,
  organization,
  orgOptions,
  onOrganizationChange,
  footerRight,
}: Props) {
  const pct = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  const up = pct >= 0;
  const gradId = React.useId();

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex min-h-0 grow flex-col gap-3 p-4 sm:p-5">
        {/* header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm text-muted-foreground">{title}</div>
            <div className="mt-1 text-2xl font-extrabold leading-tight sm:text-3xl">
              {formatValue(current)}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold",
                  up ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950" : "bg-red-100 text-red-500 dark:bg-red-950"
                )}
              >
                {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(pct).toFixed(2)}%
              </span>
              <span className="text-xs text-muted-foreground">
                {previousLabel}: {formatValue(previous)}
              </span>
            </div>
          </div>

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

        {/* chart */}
        <div className="min-h-0 grow">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_CURRENT} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLOR_CURRENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.4} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickMargin={8}
                style={{ fontSize: 12, userSelect: "none" }}
              />
              <YAxis
                orientation="right"
                tickFormatter={formatAxis ?? formatValue}
                tickLine={false}
                axisLine={false}
                width={48}
                style={{ fontSize: 12, userSelect: "none" }}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={formatValue}
                    formatDate={formatDate}
                    currentLabel={currentLabel}
                    previousLabel={previousLabel}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke={COLOR_CURRENT}
                strokeWidth={2.5}
                fill={`url(#area-${gradId})`}
                name={currentLabel}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="previous"
                stroke={COLOR_PREVIOUS}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                name={previousLabel}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* footer */}
        {(intervals?.length || footerRight) && (
          <div className="flex items-center justify-between">
            {intervals?.length ? (
              <div className="inline-flex overflow-hidden rounded-lg border">
                {intervals.map((int) => (
                  <button
                    key={int.value}
                    type="button"
                    data-active={interval === int.value}
                    onClick={() => onIntervalChange?.(int.value)}
                    className="border-l px-3 py-1 text-xs font-medium text-muted-foreground first:border-l-0 data-[active=true]:bg-muted data-[active=true]:text-foreground"
                  >
                    {int.label}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            {footerRight}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
