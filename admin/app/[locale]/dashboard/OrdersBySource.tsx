"use client";

import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { organizations } from "@admin/lib/organizations";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useTranslations } from "next-intl";
import ChartCard from "./_tremor/ChartCard";
import { compactWithUnits } from "./compact";

const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n));

type SourceRow = { name: string; orderCount: number; totalRevenue: number };

const fetchData = async (errorMessage: string, startDate: string, endDate: string, organization?: string, terminals?: string) => {
  const query: { startDate: string; endDate: string; organization?: string; terminals?: string } = { startDate, endDate };
  if (organization) query.organization = organization;
  if (terminals) query.terminals = terminals;
  const { data, status } = await apiClient.api.charts["orders-by-source"].get({ query });
  if (status !== 200 || !data || !Array.isArray((data as any).data)) {
    throw new Error(errorMessage);
  }
  return (data as any).data as SourceRow[];
};

const OrdersBySource = () => {
  const t = useTranslations("dashboardUi.ordersBySource");
  const tCharts = useTranslations("charts");
  const compact = (n: number) => compactWithUnits(n, tCharts, [2, 1, 0], fmt);
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);
  const [organization, setOrganization] = React.useState<string | null>(null);
  const [terminals] = useTerminalsFilter();

  const { data } = useSuspenseQuery({
    queryKey: ["orders-by-source", startDate, endDate, organization, terminals],
    queryFn: () => fetchData(t("loadError"), startDate.toISOString(), endDate.toISOString(), organization ?? undefined, terminals ? terminals.toString() : undefined),
  });

  const rows = React.useMemo(
    () =>
      [...data]
        .map((r) => ({ name: r.name || "—", orderCount: Number(r.orderCount) || 0, totalRevenue: Number(r.totalRevenue) || 0 }))
        .sort((a, b) => b.totalRevenue - a.totalRevenue),
    [data]
  );
  const max = rows[0]?.totalRevenue || 1;

  return (
    <ChartCard
      title={t("title")}
      organization={organization}
      orgOptions={organizations}
      onOrganizationChange={(id) => setOrganization(id || null)}
      bodyClassName="overflow-auto"
    >
      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{t("noData")}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={r.name + i} className="flex items-center gap-2 border-b py-2 last:border-0">
              <span className="w-5 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 grow">
                <div className="truncate text-sm" title={r.name}>{r.name}</div>
                <div className="relative mt-1 h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                  <div className="absolute inset-y-0 left-0 rounded bg-emerald-500" style={{ width: `${Math.max(2, (r.totalRevenue / max) * 100)}%` }} />
                </div>
              </div>
              <div className="w-24 shrink-0 text-right">
                <div className="text-xs font-semibold tabular-nums">{compact(r.totalRevenue)}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">{t("ordersShort", { count: fmt(r.orderCount) })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
};

export default OrdersBySource;
