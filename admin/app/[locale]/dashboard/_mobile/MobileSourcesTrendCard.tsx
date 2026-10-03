"use client";

import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { organizations } from "@admin/lib/organizations";
import ChartCard from "../_tremor/ChartCard";

const compact = (n: number) => {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} млрд`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} млн`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)} тыс`;
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
};

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 64, h = 18;
  if (!values.length) return <svg width={w} height={h} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={pts} />
    </svg>
  );
}

type TrendRow = { date: string; source: string; total_sales: number };

const MobileSourcesTrendCard = () => {
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const n = new Date();
    return { startDate: n, endDate: n };
  }, [dateRange]);
  const [organization, setOrganization] = React.useState<string | null>(null);
  const [terminals] = useTerminalsFilter();

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-sources-trend", startDate, endDate, organization, terminals],
    queryFn: async () => {
      const query: { startDate: string; endDate: string; interval: string; organization?: string; terminals?: string } = {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        interval: "day",
      };
      if (organization) query.organization = organization;
      if (terminals) query.terminals = terminals.toString();
      const { data, status } = await apiClient.api.charts["basket-additional-sales-trend"].get({ query });
      if (status !== 200 || !data) throw new Error("Ошибка загрузки");
      return data as { data: TrendRow[] };
    },
  });

  const rows = React.useMemo(() => {
    const bySrc = new Map<string, { total: number; series: Map<string, number> }>();
    const allDates = new Set<string>();
    for (const r of data.data) {
      allDates.add(r.date);
      const e = bySrc.get(r.source) ?? { total: 0, series: new Map() };
      const v = Number(r.total_sales) || 0;
      e.total += v;
      e.series.set(r.date, (e.series.get(r.date) || 0) + v);
      bySrc.set(r.source, e);
    }
    const dates = Array.from(allDates).sort();
    return Array.from(bySrc.entries())
      .map(([source, e]) => ({ source, total: e.total, series: dates.map((d) => e.series.get(d) ?? 0) }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  return (
    <ChartCard
      title="Доп. продажи по источникам"
      organization={organization}
      orgOptions={organizations}
      onOrganizationChange={(id) => setOrganization(id || null)}
      bodyClassName="overflow-auto"
    >
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Нет данных</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={r.source} className="flex items-center gap-2 border-b py-2 last:border-0">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 grow truncate text-sm" title={r.source}>{r.source}</div>
              <Sparkline values={r.series} color={COLORS[i % COLORS.length]} />
              <div className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums">{compact(r.total)}</div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
};

export default MobileSourcesTrendCard;
