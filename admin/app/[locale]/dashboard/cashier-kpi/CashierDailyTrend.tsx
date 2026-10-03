"use client";

import React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { Skeleton } from "@admin/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import ChartCard from "../_tremor/ChartCard";
import { fmtDay, fmtMoney } from "../cash-shifts/format";
import { cashierKpiErrorMessage, useCashierDaily, useCashierKpi } from "./useCashierKpi";
import Footnote from "./Footnote";

// Fixed categorical order, validated (light & dark) with the skill's
// palette validator: ΔE(deutan) 30.3, ΔE(normal) 33.3, all >= 3:1 on the
// card surface. Green = the primary "revenue per cashier" series (matches
// the rest of the dashboard's "current" line color), blue = the secondary
// "active cashiers" count, amber = the optional per-cashier overlay.
// Two stacked single-axis panels (dataviz skill forbids dual axes), one
// shared legend for the whole card.
const COLOR_REVENUE_PER_CASHIER = "#16a34a";
const COLOR_ACTIVE_CASHIERS = "#2563eb";
const COLOR_SELECTED_CASHIER = "#d97706";

const NONE = "__all__";

const formatCompactMoney = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)} тыс`;
  return `${Math.round(n)}`;
};

// `any` here matches the Tooltip content signature used by the other
// recharts widgets in this dashboard (recharts' payload type is unwieldy).
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-lg">
      <div className="mb-1 font-medium">{fmtDay(String(label ?? ""))}</div>
      {payload.map((p: any) =>
        p.value == null ? null : (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name}:{" "}
            <span className="font-semibold">
              {p.dataKey === "active_cashiers" ? p.value : fmtMoney(p.value)}
            </span>
          </div>
        )
      )}
    </div>
  );
}

// One legend for the whole card (two panels below share it) instead of a
// recharts <Legend> per panel.
function CardLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

const CashierDailyTrend = () => {
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const [cashierId, setCashierId] = React.useState<string | null>(null);

  const kpiQuery = useCashierKpi(startDate, endDate, terminals);
  const dailyQuery = useCashierDaily(startDate, endDate, terminals, cashierId);

  // The KPI endpoint is already sorted by revenue desc; disambiguate shared
  // logins the same way the ranked cards do.
  const cashierOptions = React.useMemo(() => {
    const cashiers = kpiQuery.data?.cashiers ?? [];
    const nameCounts = new Map<string, number>();
    for (const c of cashiers) nameCounts.set(c.cashier_name, (nameCounts.get(c.cashier_name) ?? 0) + 1);
    return cashiers.map((c) => ({
      id: c.cashier_id,
      label:
        (nameCounts.get(c.cashier_name) ?? 0) > 1
          ? `${c.cashier_name} · ${c.terminal_name ?? "?"}`
          : c.cashier_name,
    }));
  }, [kpiQuery.data]);

  // The date range or terminal filter can change the cashier list under a
  // selection made earlier — drop it back to "all" rather than render an
  // empty "Выбранный кассир" line for a cashier no longer in scope.
  React.useEffect(() => {
    if (!kpiQuery.data) return;
    if (cashierId && !cashierOptions.some((o) => o.id === cashierId)) {
      setCashierId(null);
    }
  }, [kpiQuery.data, cashierOptions, cashierId]);

  const selectedLabel = cashierOptions.find((o) => o.id === cashierId)?.label ?? null;

  const days = dailyQuery.data?.days ?? [];
  const error = dailyQuery.isError
    ? cashierKpiErrorMessage(dailyQuery.error)
    : kpiQuery.isError
      ? cashierKpiErrorMessage(kpiQuery.error)
      : null;
  const loading = dailyQuery.isLoading || kpiQuery.isLoading;

  const legendItems = [
    { color: COLOR_REVENUE_PER_CASHIER, label: "Выручка на кассира" },
    ...(cashierId
      ? [{ color: COLOR_SELECTED_CASHIER, label: selectedLabel ? `Выбранный кассир: ${selectedLabel}` : "Выбранный кассир" }]
      : []),
    { color: COLOR_ACTIVE_CASHIERS, label: "Активных кассиров" },
  ];

  return (
    <ChartCard
      title="Кассиры: динамика по дням"
      headerRight={
        <Select value={cashierId ?? NONE} onValueChange={(v) => setCashierId(v === NONE ? null : v)}>
          <SelectTrigger size="sm" className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Все кассиры" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Все кассиры</SelectItem>
            {cashierOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      <div className="flex h-full flex-col gap-2">
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : loading ? (
          <Skeleton className="min-h-0 w-full flex-1 rounded-lg" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <CardLegend items={legendItems} />
            {/* Upper panel (~60% of the body): money — one axis. */}
            <div className="min-h-0" style={{ flex: "3 1 0%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} syncId="cashier-trend">
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis dataKey="day" tick={false} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis
                    tickFormatter={formatCompactMoney}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    style={{ fontSize: 12, userSelect: "none" }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="revenue_per_cashier"
                    name="Выручка на кассира"
                    stroke={COLOR_REVENUE_PER_CASHIER}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {cashierId && (
                    <Line
                      type="monotone"
                      dataKey="cashier_revenue"
                      name={selectedLabel ? `Выбранный кассир: ${selectedLabel}` : "Выбранный кассир"}
                      stroke={COLOR_SELECTED_CASHIER}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Lower panel (~40% of the body): a plain count — its own axis. */}
            <div className="min-h-0" style={{ flex: "2 1 0%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} syncId="cashier-trend">
                  <CartesianGrid vertical={false} strokeOpacity={0.4} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={fmtDay}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                    tickMargin={8}
                    style={{ fontSize: 12, userSelect: "none" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    style={{ fontSize: 12, userSelect: "none" }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="active_cashiers"
                    name="Активных кассиров"
                    stroke={COLOR_ACTIVE_CASHIERS}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <Footnote />
      </div>
    </ChartCard>
  );
};

export default CashierDailyTrend;
