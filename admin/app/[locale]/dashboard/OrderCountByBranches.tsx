"use client";

import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { organizations } from "@admin/lib/organizations";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTranslations } from "next-intl";
import RankedBarCard, { BranchRow } from "./_tremor/RankedBarCard";

const fetchData = async (
  startDate: string,
  endDate: string,
  organization?: string,
  terminals?: string
) => {
  const query: any = { startDate, endDate };
  if (organization) query.organization = organization;
  if (terminals) query.terminals = terminals;

  const { data, status } = await apiClient.api.charts["order-count-by-branches"].get({ query });

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

const OrderCountByBranches = () => {
  const t = useTranslations();
  const compact = (n: number) => {
    const million = 1_000_000, thousand = 1_000;
    if (Math.abs(n) >= million) return `${(n / million).toFixed(1)} ${t("charts.million")}`;
    if (Math.abs(n) >= thousand) return `${(n / thousand).toFixed(1)} ${t("charts.thousand")}`;
    return n.toString();
  };

  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange) return { startDate: dateRange.from!, endDate: dateRange.to! };
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);

  const [terminals] = useTerminalsFilter();
  const [organization, setOrganization] = React.useState<string | null>(null);

  const { data } = useSuspenseQuery({
    queryKey: ["order-count-by-branches", startDate, endDate, terminals, organization],
    queryFn: () =>
      fetchData(
        startDate.toISOString(),
        endDate.toISOString(),
        organization ?? undefined,
        terminals ? terminals.toString() : undefined
      ),
  });

  const rows: BranchRow[] = React.useMemo(
    () =>
      (data && "data" in data && Array.isArray(data.data) ? data.data : []).map((b: any) => ({
        name: b.name,
        current: Number(b.current_order_count) || 0,
        previous: b.previous_order_count != null ? Number(b.previous_order_count) : null,
      })),
    [data]
  );

  return (
    <RankedBarCard
      title={t("charts.OrderCountByBranches.title")}
      rows={rows}
      formatValue={compact}
      organization={organization}
      orgOptions={!terminals ? organizations : undefined}
      onOrganizationChange={setOrganization}
    />
  );
};

export default OrderCountByBranches;
