"use client";

import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { formatDate, intervals } from "./intervalFunctions";
import { organizations } from "@admin/lib/organizations";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTranslations } from "next-intl";
import KpiAreaCard, { KpiPoint } from "./_tremor/KpiAreaCard";

const fetchAverageCheckData = async (
  startDate: string,
  endDate: string,
  interval: string,
  terminals?: string,
  organizationId?: string
) => {
  if (!startDate || !endDate) {
    throw new Error("Date filter is mandatory");
  }

  let query: {
    startDate: string;
    endDate: string;
    interval: string;
    terminals?: string;
    organizationId?: string;
  } = { startDate, endDate, interval };

  if (terminals) query = { ...query, terminals };
  if (organizationId) query = { ...query, organizationId };

  const { data, status } = await apiClient.api.charts["average-check"].get({ query });

  if (status != 200) {
    let errorMessage = "Error fetching data";
    if (data && typeof data === "object" && "message" in data) {
      errorMessage = String(data.message);
    }
    throw new Error(errorMessage);
  }
  if (!data || !data.data || !Array.isArray(data.data)) {
    throw new Error("No data found or invalid data format");
  }
  return data;
};

const AverageCheckChart = () => {
  const t = useTranslations();
  const formatCompactNumber = (number: number) => {
    const million = 1_000_000;
    const thousand = 1_000;
    if (Math.abs(number) >= million) return `${(number / million).toFixed(1)} ${t("charts.million")}`;
    if (Math.abs(number) >= thousand) return `${(number / thousand).toFixed(0)} ${t("charts.thousand")}`;
    return number.toString();
  };

  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange) return { startDate: dateRange.from!, endDate: dateRange.to! };
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);

  const [terminals] = useTerminalsFilter();
  const [organization, setOrganization] = React.useState<string | null>(null);
  const [interval, setInterval] = React.useState("1 day");

  const { data } = useSuspenseQuery({
    queryKey: ["average-check", startDate, endDate, interval, terminals, organization],
    queryFn: () =>
      fetchAverageCheckData(
        startDate.toISOString(),
        endDate.toISOString(),
        interval,
        terminals ? terminals.toString() : undefined,
        organization ?? undefined
      ),
  });

  const series: KpiPoint[] = React.useMemo(
    () =>
      (data && "data" in data && Array.isArray(data.data) ? data.data : []).map((d: any) => ({
        date: d.date,
        current: typeof d.current_avg_check === "number" ? d.current_avg_check : Number(d.current_avg_check) || 0,
        previous: d.previous_avg_check != null ? Number(d.previous_avg_check) : null,
      })),
    [data]
  );

  // Average check: mean across the period (not sum).
  const avg = (key: "current" | "previous") => {
    const vals = series.map((d) => (key === "current" ? d.current : d.previous ?? 0)).filter((v) => v > 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };
  const current = avg("current");
  const previous = avg("previous");

  return (
    <KpiAreaCard
      title={t("charts.AverageCheckChart.title")}
      current={current}
      previous={previous}
      data={series}
      formatValue={(n) => Math.round(n).toLocaleString("ru-RU")}
      formatAxis={formatCompactNumber}
      formatDate={(d) => formatDate(d, interval)}
      currentLabel={t("charts.AverageCheckChart.currentAverageCheck")}
      previousLabel={t("charts.AverageCheckChart.previousAverageCheck")}
      interval={interval}
      intervals={intervals(t)}
      onIntervalChange={setInterval}
      organization={organization}
      orgOptions={!terminals ? organizations : undefined}
      onOrganizationChange={setOrganization}
    />
  );
};

export default AverageCheckChart;
