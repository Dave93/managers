"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { Skeleton } from "@admin/components/ui/skeleton";
import RankedBarCard from "../_tremor/RankedBarCard";
import { MIN_ORDERS_FOR_AVG, networkAverage, toRankedRows } from "./kpi";
import { cashierKpiErrorMessage, useCashierKpi } from "./useCashierKpi";
import Footnote from "./Footnote";

const CardSkeleton = () => <Skeleton className="min-h-0 w-full flex-1 rounded-lg" />;

// The network figure lives in RankedBarCard's subtitle slot, under the
// title, so the card top lines up with the other cards in the row.
const CashierOrdersPerHour = () => {
  const t = useTranslations("dashboardUi.cashierKpi");
  const fmtOrdersPerHour = (n: number) => t("ordersPerHourValue", { value: n.toFixed(1) });
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const query = useCashierKpi(startDate, endDate, terminals);
  const cashiers = React.useMemo(() => query.data?.cashiers ?? [], [query.data]);

  const rows = React.useMemo(
    () => toRankedRows(cashiers, "orders_per_hour", { minOrders: MIN_ORDERS_FOR_AVG, limit: 10 }),
    [cashiers]
  );
  const avg = React.useMemo(
    () => networkAverage(cashiers, "orders_per_hour", MIN_ORDERS_FOR_AVG),
    [cashiers]
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{cashierKpiErrorMessage(query.error, t)}</p>
      ) : query.isLoading ? (
        <CardSkeleton />
      ) : (
        <div className="min-h-0 flex-1">
          <RankedBarCard
            title={t("ordersPerHourTitle")}
            rows={rows}
            formatValue={fmtOrdersPerHour}
            subtitle={t("ordersPerHourSubtitle", { avg: fmtOrdersPerHour(avg), min: MIN_ORDERS_FOR_AVG })}
          />
        </div>
      )}
      <Footnote />
    </div>
  );
};

export default CashierOrdersPerHour;
