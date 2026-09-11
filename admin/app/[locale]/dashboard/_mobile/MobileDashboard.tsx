"use client";

import React, { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@admin/components/ui/card";
import { cn } from "@admin/lib/utils";
import { apiClient } from "@admin/utils/eden";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import LoadingAnimation from "../LoadingAnimation";
import OrderDistributionChart from "../OrderDistributionChart";
import MobileSourcesTrendCard from "./MobileSourcesTrendCard";
import StoplistByDay from "../StoplistByDay";
import CashShiftsByDay from "../CashShiftsByDay";
import CashierRevenueTop from "../cashier-kpi/CashierRevenueTop";
import CashierAvgCheck from "../cashier-kpi/CashierAvgCheck";
import CashierOrdersPerHour from "../cashier-kpi/CashierOrdersPerHour";
import CashierDailyTrend from "../cashier-kpi/CashierDailyTrend";

// ---- shared ----------------------------------------------------------------

const useFilters = () => {
  const { dateRange } = useDateRangeState();
  const [terminals] = useTerminalsFilter();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    terminals: terminals ? terminals.toString() : undefined,
  };
};

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

const compactNum = (n: number) => {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} млрд`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)} млн`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)} тыс`;
  return fmt(n);
};

const Delta = ({ current, previous }: { current: number; previous: number }) => {
  const pct = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
        up ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950" : "bg-red-100 text-red-500 dark:bg-red-950"
      }`}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

const TileBoundary = ({ children }: { children: React.ReactNode }) => (
  <ErrorBoundary fallback={<Card><CardContent className="p-3 text-xs text-red-500">Ошибка</CardContent></Card>}>
    <Suspense
      fallback={
        <Card>
          <CardContent className="p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-6 w-24 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      }
    >
      {children}
    </Suspense>
  </ErrorBoundary>
);

// Full-width wrapper for the detailed (non-tile) chart/table cards on mobile.
const CardWrap = ({ height, children }: { height: string; children: React.ReactNode }) => (
  <div className={cn("min-w-0", height)}>
    <ErrorBoundary fallback={<Card><CardContent className="p-4 text-sm text-red-500">Ошибка загрузки</CardContent></Card>}>
      <Suspense fallback={<div className="flex h-full items-center justify-center"><LoadingAnimation /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  </div>
);

// ---- number tile -----------------------------------------------------------

type TileProps = {
  title: string;
  endpoint: "revenue" | "order-count" | "average-check";
  curField: string;
  prevField: string;
  /** average-check uses the mean across the period, others sum. */
  agg?: "sum" | "mean";
  /** show the value in compact form (2.77 млрд) instead of the full number. */
  compact?: boolean;
};

const NumberTile = ({ title, endpoint, curField, prevField, agg = "sum", compact = false }: TileProps) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: Record<string, string> = { startDate, endDate, interval: "1 day" };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-tile", endpoint, startDate, endDate, terminals],
    queryFn: async () => {
      // @ts-ignore — dynamic Eden segment, shape checked below
      const res = await apiClient.api.charts[endpoint].get({ query });
      if (res.status !== 200 || !res.data || !Array.isArray((res.data as any).data)) {
        throw new Error("Ошибка загрузки");
      }
      return (res.data as any).data as Record<string, any>[];
    },
  });

  const cur = data.map((d) => Number(d[curField]) || 0);
  const prev = data.map((d) => (d[prevField] != null ? Number(d[prevField]) || 0 : 0));
  const reduce = (arr: number[]) => {
    if (agg === "mean") {
      const v = arr.filter((x) => x > 0);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
    }
    return arr.reduce((s, x) => s + x, 0);
  };
  const current = reduce(cur);
  const previous = reduce(prev);

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-between p-4">
        <div className="truncate text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 text-xl font-extrabold leading-tight">{compact ? compactNum(current) : fmt(current)}</div>
        <div className="mt-1.5">
          <Delta current={current} previous={previous} />
        </div>
      </CardContent>
    </Card>
  );
};

// ---- online/offline distribution tile --------------------------------------

const DistributionTile = ({ title, match }: { title: string; match: string }) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: { startDate: string; endDate: string; terminals?: string } = { startDate, endDate };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-dist", startDate, endDate, terminals],
    queryFn: async () => {
      const res = await apiClient.api.charts["order-distribution"].get({ query });
      if (res.status !== 200 || !res.data || !(res.data as any).data) throw new Error("Ошибка загрузки");
      return (res.data as any).data as { current: { name: string; value: number }[]; previous: { name: string; value: number }[] };
    },
  });

  const sum = (arr: { name: string; value: number }[]) =>
    arr.filter((x) => (x.name || "").toLowerCase().includes(match)).reduce((s, x) => s + (Number(x.value) || 0), 0);
  const current = sum(data.current);
  const previous = sum(data.previous);

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-between p-4">
        <div className="truncate text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 text-xl font-extrabold leading-tight">{fmt(current)}</div>
        <div className="mt-1.5"><Delta current={current} previous={previous} /></div>
      </CardContent>
    </Card>
  );
};

// ---- top branch tile --------------------------------------------------------

const TopBranchTile = ({ title }: { title: string }) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: { startDate: string; endDate: string; terminals?: string } = { startDate, endDate };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-topbranch", startDate, endDate, terminals],
    queryFn: async () => {
      const res = await apiClient.api.charts["revenue-by-branches"].get({ query });
      if (res.status !== 200 || !res.data || !Array.isArray((res.data as any).data)) throw new Error("Ошибка загрузки");
      return (res.data as any).data as { name: string; current_revenue: number; previous_revenue: number | null }[];
    },
  });

  const top = [...data]
    .map((b) => ({ name: b.name, current: Number(b.current_revenue) || 0, previous: b.previous_revenue != null ? Number(b.previous_revenue) || 0 : 0 }))
    .sort((a, b) => b.current - a.current)[0];

  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-between p-4">
        <div className="truncate text-xs text-muted-foreground">{title}</div>
        {top ? (
          <>
            <div className="mt-1 truncate text-sm font-semibold leading-tight">{top.name}</div>
            <div className="text-lg font-extrabold leading-tight">{compactNum(top.current)}</div>
            <div className="mt-1.5"><Delta current={top.current} previous={top.previous} /></div>
          </>
        ) : (
          <div className="mt-1 text-sm text-muted-foreground">нет данных</div>
        )}
      </CardContent>
    </Card>
  );
};

// ---- hourly bars (mobile replacement for the 24x7 heatmap) -----------------

const HourlyBarsCard = ({ title, field, formatValue }: { title: string; field: string; formatValue: (n: number) => string }) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: { startDate: string; endDate: string; terminals?: string } = { startDate, endDate };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-hourly", field, startDate, endDate, terminals],
    queryFn: async () => {
      const res = await apiClient.api.charts["hourly-heatmap"].get({ query });
      if (res.status !== 200 || !res.data || !Array.isArray((res.data as any).data)) {
        throw new Error("Ошибка загрузки");
      }
      return (res.data as any).data as { dayOfWeek: number; hour: number; [k: string]: any }[];
    },
  });

  const byHour = Array.from({ length: 24 }, () => 0);
  for (const d of data) {
    const h = Number(d.hour);
    if (h >= 0 && h < 24) byHour[h] += Number(d[field]) || 0;
  }
  const max = Math.max(...byHour, 1);
  const peak = byHour.indexOf(max);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold">{title}</div>
        <div className="space-y-1">
          {byHour.map((v, h) => (
            <div key={h} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {String(h).padStart(2, "0")}:00
              </span>
              <div className="relative h-4 grow overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                <div
                  className={cn("absolute inset-y-0 left-0 rounded", h === peak ? "bg-emerald-600" : "bg-emerald-400")}
                  style={{ width: `${v > 0 ? Math.max(4, (v / max) * 100) : 0}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">{formatValue(v)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ---- ranked top-N list (mobile replacement for wide basket tables) ---------

const MobileRankedList = ({
  title,
  endpoint,
  arrayKey,
  nameField = "name",
  subField,
}: {
  title: string;
  endpoint: "basket-additional-sales" | "basket-additional-sales-by-source" | "basket-additional-sales-by-source-group";
  arrayKey: "products" | "sources" | "productSources";
  nameField?: string;
  subField?: string;
}) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: { startDate: string; endDate: string; terminals?: string } = { startDate, endDate };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-ranked", endpoint, startDate, endDate, terminals],
    queryFn: async () => {
      // @ts-ignore — dynamic Eden segment
      const res = await apiClient.api.charts[endpoint].get({ query });
      if (res.status !== 200 || !res.data) throw new Error("Ошибка загрузки");
      return res.data as any;
    },
  });

  const sumField = (it: any, f: string) =>
    Number(it?.[f]) || (Array.isArray(it?.sources) ? it.sources.reduce((s: number, x: any) => s + (Number(x?.[f]) || 0), 0) : 0);

  const rows = ((data?.data?.[arrayKey] as any[]) ?? [])
    .map((it) => ({
      name: [it[nameField], subField ? it[subField] : null].filter(Boolean).join(" · ") || "—",
      qty: sumField(it, "quantity"),
      sales: sumField(it, "totalSales"),
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 12);
  const max = rows[0]?.sales || 1;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold">{title}</div>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Нет данных</div>
        ) : (
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div key={r.name + i} className="flex items-center gap-2 border-b py-2 last:border-0">
                <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 grow">
                  <div className="truncate text-sm" title={r.name}>{r.name}</div>
                  <div className="relative mt-1 h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div className="absolute inset-y-0 left-0 rounded bg-emerald-500" style={{ width: `${Math.max(2, (r.sales / max) * 100)}%` }} />
                  </div>
                </div>
                <div className="w-20 shrink-0 text-right">
                  <div className="text-xs font-semibold tabular-nums">{compactNum(r.sales)}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">{fmt(r.qty)} шт</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ---- simple {name,value} ranked list (popular dishes) ----------------------

const SimpleRankedList = ({ title, endpoint, formatValue }: { title: string; endpoint: "popular-dishes" | "popular-dishes-by-price"; formatValue: (n: number) => string }) => {
  const { startDate, endDate, terminals } = useFilters();
  const query: { startDate: string; endDate: string; interval: string; terminals?: string } = { startDate, endDate, interval: "1 day" };
  if (terminals) query.terminals = terminals;

  const { data } = useSuspenseQuery({
    queryKey: ["mobile-simple", endpoint, startDate, endDate, terminals],
    queryFn: async () => {
      // @ts-ignore — dynamic Eden segment
      const res = await apiClient.api.charts[endpoint].get({ query });
      if (res.status !== 200 || !res.data || !Array.isArray((res.data as any).data)) throw new Error("Ошибка загрузки");
      return (res.data as any).data as { name: string; value: number }[];
    },
  });

  const rows = [...data]
    .map((d) => ({ name: d.name ?? "—", value: Number(d.value) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  const max = rows[0]?.value || 1;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold">{title}</div>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Нет данных</div>
        ) : (
          <div className="space-y-1">
            {rows.map((r, i) => (
              <div key={r.name + i} className="flex items-center gap-2 border-b py-2 last:border-0">
                <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 grow">
                  <div className="truncate text-sm" title={r.name}>{r.name}</div>
                  <div className="relative mt-1 h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div className="absolute inset-y-0 left-0 rounded bg-emerald-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                  </div>
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">{formatValue(r.value)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ---- mobile dashboard ------------------------------------------------------

export default function MobileDashboard() {
  const t = useTranslations();
  const { startDate, endDate } = useFilters();
  const lastYear = (iso: string) => {
    const d = new Date(iso);
    d.setFullYear(d.getFullYear() - 1);
    return d.toLocaleDateString("ru-RU");
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        ↑↓ — к тому же периоду год назад ({lastYear(startDate)} – {lastYear(endDate)})
      </p>
      <div className="grid grid-cols-2 gap-3">
      <TileBoundary>
        <NumberTile title={t("charts.RevenueChart.title")} endpoint="revenue" curField="current_revenue" prevField="previous_revenue" compact />
      </TileBoundary>
      <TileBoundary>
        <NumberTile title={t("charts.OrderCountChart.title")} endpoint="order-count" curField="current_order_count" prevField="previous_order_count" />
      </TileBoundary>
      <TileBoundary>
        <NumberTile title={t("charts.AverageCheckChart.title")} endpoint="average-check" curField="current_avg_check" prevField="previous_avg_check" agg="mean" />
      </TileBoundary>
      <TileBoundary>
        <DistributionTile title="Онлайн заказы" match="online" />
      </TileBoundary>
      <TileBoundary>
        <DistributionTile title="Офлайн заказы" match="offline" />
      </TileBoundary>
      <TileBoundary>
        <TopBranchTile title="Топ филиал" />
      </TileBoundary>
      </div>

      {/* detailed cards (full width, stacked) */}
      <div className="space-y-3">
        <CardWrap height="h-[300px]"><OrderDistributionChart /></CardWrap>
        <TileBoundary><HourlyBarsCard title={t("charts.OrderHourlyHeatmapChart.title")} field="averageOrderCount" formatValue={(n) => fmt(n)} /></TileBoundary>
        <TileBoundary><HourlyBarsCard title={t("charts.OrderAmountHourlyHeatmapChart.title")} field="averageRevenue" formatValue={compactNum} /></TileBoundary>
        <TileBoundary><SimpleRankedList title="Топ блюд — количество" endpoint="popular-dishes" formatValue={(n) => fmt(n)} /></TileBoundary>
        <TileBoundary><SimpleRankedList title="Топ блюд — сумма" endpoint="popular-dishes-by-price" formatValue={compactNum} /></TileBoundary>
        <TileBoundary><MobileRankedList title="Доп. продажи" endpoint="basket-additional-sales" arrayKey="products" /></TileBoundary>
        <TileBoundary><MobileRankedList title="Доп. продажи по источникам" endpoint="basket-additional-sales-by-source" arrayKey="sources" /></TileBoundary>
        <TileBoundary><MobileRankedList title="Доп. продажи по группам" endpoint="basket-additional-sales-by-source-group" arrayKey="productSources" nameField="productName" subField="sourceName" /></TileBoundary>
        <TileBoundary><MobileSourcesTrendCard /></TileBoundary>
        <CardWrap height="h-[520px]"><StoplistByDay /></CardWrap>
        <CardWrap height="h-auto"><CashShiftsByDay /></CardWrap>
        <CardWrap height="h-[420px]"><CashierRevenueTop /></CardWrap>
        <CardWrap height="h-[420px]"><CashierAvgCheck /></CardWrap>
        <CardWrap height="h-[420px]"><CashierOrdersPerHour /></CardWrap>
        <CardWrap height="h-[440px]"><CashierDailyTrend /></CardWrap>
      </div>
    </div>
  );
}
