"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@admin/components/ui/card";
import { Skeleton } from "@admin/components/ui/skeleton";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useCashShiftSettings } from "@admin/store/states/cash_shift_settings";
import { computeFlags, tashkentToday } from "./cash-shifts/flags";
import DayStrip, { type DaySummary } from "./cash-shifts/DayStrip";
import DayTimeline from "./cash-shifts/DayTimeline";
import SettingsPopover from "./cash-shifts/SettingsPopover";
import { fmtDayMonthTime, plural } from "./cash-shifts/format";
import type { CashShiftFull, CashShiftLite } from "./cash-shifts/types";

// Cash shift routes live on a widened (non-Eden) controller, so this widget
// uses same-origin fetch like StoplistByDay: Next.js proxies /api/* to the
// backend and the session cookie rides along.
async function getJson<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`${path}?${params.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const StripSkeleton = () => (
  <div className="flex shrink-0 gap-2 overflow-hidden pb-1">
    {Array.from({ length: 6 }, (_, i) => (
      <Skeleton key={i} className="h-[68px] w-[7.5rem] shrink-0 rounded-lg" />
    ))}
  </div>
);

const TimelineSkeleton = () => (
  <div className="space-y-2 rounded-md border p-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="flex items-center gap-3">
        <Skeleton className="h-4 w-40 shrink-0" />
        <Skeleton className="h-5" style={{ marginLeft: `${8 + ((i * 7) % 12)}%`, width: `${45 + ((i * 11) % 25)}%` }} />
      </div>
    ))}
  </div>
);

const CashShiftsByDay = () => {
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;
  const settings = useCashShiftSettings();
  const today = tashkentToday();

  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const listQuery = useQuery<{ shifts: CashShiftLite[]; synced_at?: string | null }>({
    queryKey: ["cash_shifts", startDate, endDate, terminals],
    queryFn: () => {
      const p = new URLSearchParams({ startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      if (terminals) p.set("terminals", terminals);
      return getJson("/api/cash_shifts", p);
    },
  });

  const days: DaySummary[] = React.useMemo(() => {
    const { visible } = computeFlags(listQuery.data?.shifts ?? [], settings, today);
    const acc = new Map<string, DaySummary>();
    for (const s of visible) {
      const d = acc.get(s.business_date) ?? { day: s.business_date, shifts: 0, flagged: 0 };
      d.shifts++;
      if (s.flags.length > 0) d.flagged++;
      acc.set(s.business_date, d);
    }
    return [...acc.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [listQuery.data, settings, today]);

  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  // Without a selection open the latest complete day: today is still partial.
  const activeDay = React.useMemo(() => {
    if (selectedDay && days.some((d) => d.day === selectedDay)) return selectedDay;
    return days.find((d) => d.day < today)?.day ?? days[0]?.day ?? null;
  }, [selectedDay, days, today]);

  const dayQuery = useQuery<{ day: string; shifts: CashShiftFull[] }>({
    queryKey: ["cash_shifts_day", activeDay, terminals],
    enabled: !!activeDay,
    queryFn: () => {
      const p = new URLSearchParams({ day: activeDay! });
      if (terminals) p.set("terminals", terminals);
      return getJson("/api/cash_shifts/day", p);
    },
  });

  const dayFlags = React.useMemo(
    () => computeFlags(dayQuery.data?.shifts ?? [], settings, today),
    [dayQuery.data, settings, today]
  );

  const syncedAt = listQuery.data?.synced_at ?? null;
  const totals = days.reduce(
    (t, d) => ({ shifts: t.shifts + d.shifts, flagged: t.flagged + d.flagged }),
    { shifts: 0, flagged: 0 }
  );
  // The API refuses periods over 92 days with 400.
  const listError =
    listQuery.error instanceof Error && listQuery.error.message === "HTTP 400"
      ? "Период больше 92 дней. Выберите период короче."
      : "Не удалось загрузить смены.";

  return (
    <Card className="flex h-full flex-col gap-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Кассовые смены</CardTitle>
          {listQuery.isSuccess && (days.length > 0 || syncedAt) && (
            <CardDescription className="flex flex-wrap gap-x-3 text-xs tabular-nums">
              {days.length > 0 && (
                <span>
                  {totals.shifts.toLocaleString("ru-RU")} {plural(totals.shifts, "смена", "смены", "смен")} за
                  период, с нарушениями: {totals.flagged.toLocaleString("ru-RU")}
                </span>
              )}
              {syncedAt && <span>данные на {fmtDayMonthTime(syncedAt)}</span>}
            </CardDescription>
          )}
        </div>
        <SettingsPopover />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        {listQuery.isError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{listError}</p>
        ) : listQuery.isLoading ? (
          <StripSkeleton />
        ) : (
          <DayStrip days={days} active={activeDay} onSelect={setSelectedDay} />
        )}
        {activeDay &&
          (dayQuery.isError ? (
            <p className="text-sm text-red-600 dark:text-red-400">Не удалось загрузить день.</p>
          ) : dayQuery.isLoading ? (
            <TimelineSkeleton />
          ) : (
            <>
              <DayTimeline day={activeDay} shifts={dayFlags.visible} />
              {dayFlags.hiddenCount > 0 && (
                <p className="-mt-2 shrink-0 text-xs text-muted-foreground">
                  Скрыто коротких смен: {dayFlags.hiddenCount}
                </p>
              )}
            </>
          ))}
      </CardContent>
    </Card>
  );
};

export default CashShiftsByDay;
