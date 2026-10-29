"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { Skeleton } from "@admin/components/ui/skeleton";
import RankedBarCard from "../_tremor/RankedBarCard";
import { useFmtMoney } from "../cash-shifts/format";
import { toRankedRows } from "./kpi";
import { cashierKpiErrorMessage, useCashierKpi } from "./useCashierKpi";
import Footnote from "./Footnote";

const CardSkeleton = () => <Skeleton className="min-h-0 w-full flex-1 rounded-lg" />;

// The "show more" toggle lives in RankedBarCard's headerRight slot so the
// card top lines up with the other cards in the row.
const CashierRevenueTop = () => {
  const t = useTranslations("dashboardUi.cashierKpi");
  const fmtMoney = useFmtMoney();
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const query = useCashierKpi(startDate, endDate, terminals);
  const [expanded, setExpanded] = React.useState(false);

  const rows = React.useMemo(
    () => toRankedRows(query.data?.cashiers ?? [], "revenue", { limit: expanded ? 25 : 10 }),
    [query.data, expanded]
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
            title={t("revenueTitle")}
            rows={rows}
            formatValue={fmtMoney}
            headerRight={
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {expanded ? t("collapse") : t("show25")}
              </button>
            }
          />
        </div>
      )}
      <Footnote />
    </div>
  );
};

export default CashierRevenueTop;
