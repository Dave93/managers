"use client";

import React, { useState, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { organizations } from "@admin/lib/organizations";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTranslations } from "next-intl";
import ChartCard from "./_tremor/ChartCard";

const COLORS = { current: "#16a34a", previous: "#94a3b8" };

interface OrderDistributionData { name: string; value: number; }
interface ApiResponse {
  data: { current: OrderDistributionData[]; previous: OrderDistributionData[] };
  debug?: { sqlQueryTime: number; apiTime: number };
}
type ApiResult = { data: ApiResponse; error?: unknown; status: number } | null;

const fetchOrderDistributionData = async (
  startDate: string,
  endDate: string,
  terminals?: string,
  organizationId?: string
): Promise<ApiResponse> => {
  if (!startDate || !endDate) throw new Error("Date filter is mandatory");
  const query = {
    startDate,
    endDate,
    ...(terminals && { terminals }),
    ...(organizationId && { organizationId }),
  };
  const result = (await apiClient.api.charts["order-distribution"].get({ query })) as ApiResult;
  if (!result || result.status !== 200 || !result.data) {
    const errorMessage =
      result?.data && typeof result.data === "object" && "message" in result.data
        ? String((result.data as any).message)
        : "Error fetching data";
    throw new Error(errorMessage);
  }
  return result.data;
};

const formatCompactNumber = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};

const DistributionTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-2 shadow-sm">
      <div className="grid gap-2">
        <div className="font-semibold">{payload[0].payload.name}</div>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
            <span className="flex-1">{entry.name}:</span>
            <span className="font-medium">{entry.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const OrderDistributionChart = () => {
  const t = useTranslations();
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange) return { startDate: dateRange.from!, endDate: dateRange.to! };
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);
  const [organization, setOrganization] = useState<string | null>(null);
  const [terminals] = useTerminalsFilter();

  const { data } = useSuspenseQuery({
    queryKey: ["orderDistribution", startDate, endDate, terminals, organization],
    queryFn: () =>
      fetchOrderDistributionData(
        startDate.toISOString(),
        endDate.toISOString(),
        terminals ? terminals.toString() : undefined,
        organization || undefined
      ),
  });

  const currentTotal = useMemo(() => data?.data.current.reduce((s, i) => s + i.value, 0) || 0, [data]);
  const previousTotal = useMemo(() => data?.data.previous.reduce((s, i) => s + i.value, 0) || 0, [data]);
  const pct = previousTotal !== 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;
  const up = pct >= 0;

  const combinedData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.current.map((item) => ({
      name: item.name,
      current: item.value,
      previous: data.data.previous.find((p) => p.name === item.name)?.value || 0,
    }));
  }, [data]);

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      <span className="font-bold text-foreground">{currentTotal.toLocaleString()}</span>
      <span className={`inline-flex items-center gap-0.5 font-bold ${up ? "text-emerald-600" : "text-red-500"}`}>
        {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {Math.abs(pct).toFixed(1)}%
      </span>
      <span>{t("charts.OrderDistributionChart.previous")}: {previousTotal.toLocaleString()}</span>
    </span>
  );

  return (
    <ChartCard
      title={t("charts.OrderDistributionChart.title")}
      subtitle={subtitle}
      organization={organization}
      orgOptions={!terminals ? organizations : undefined}
      onOrganizationChange={(id) => setOrganization(id || null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={combinedData} margin={{ top: 10, right: 4, left: 0, bottom: 5 }} barGap={0} barCategoryGap="20%">
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={4} minTickGap={16} style={{ fontSize: 12, userSelect: "none" }} />
          <YAxis tickFormatter={formatCompactNumber} tickLine={false} axisLine={false} orientation="right" width={48} style={{ fontSize: 12, userSelect: "none" }} />
          <Tooltip content={<DistributionTooltip />} />
          <Legend verticalAlign="top" wrapperStyle={{ top: 0, fontSize: 12 }} />
          <Bar dataKey="current" name={t("charts.OrderDistributionChart.current")} fill={COLORS.current} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
          <Bar dataKey="previous" name={t("charts.OrderDistributionChart.previous")} fill={COLORS.previous} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
};

export default OrderDistributionChart;
