"use client";

import React from "react";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { Skeleton } from "@admin/components/ui/skeleton";
import RankedBarCard from "../_tremor/RankedBarCard";
import { fmtMoney } from "../cash-shifts/format";
import { toRankedRows } from "./kpi";
import { cashierKpiErrorMessage, useCashierKpi } from "./useCashierKpi";
import Footnote from "./Footnote";

const CardSkeleton = () => <Skeleton className="min-h-0 w-full flex-1 rounded-lg" />;

// Ranked bar card has no built-in "show more" slot, so the toggle button
// lives in this wrapper, above the card, per the brief.
const CashierRevenueTop = () => {
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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Свернуть" : "Показать 25"}
        </button>
      </div>
      {query.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{cashierKpiErrorMessage(query.error)}</p>
      ) : query.isLoading ? (
        <CardSkeleton />
      ) : (
        <div className="min-h-0 flex-1">
          <RankedBarCard title="Кассиры: выручка" rows={rows} formatValue={fmtMoney} />
        </div>
      )}
      <Footnote />
    </div>
  );
};

export default CashierRevenueTop;
