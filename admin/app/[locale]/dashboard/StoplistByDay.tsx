"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import { Input } from "@admin/components/ui/input";
import { cn } from "@admin/lib/utils";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";

// The stoplist endpoints live on a widened (non-Eden) controller, so this widget
// talks to them with plain same-origin fetch — Next.js rewrites proxy /api/* to
// the backend and the session cookie rides along. Same reasoning as the
// /stoplist manager page.
type DayRow = {
  day: string;
  stops: number;
  products: number;
  terminals: number;
  still_open: number;
  les: number;
  chopar: number;
};
type ItemRow = {
  brand: string;
  terminal_id: number;
  terminal_name: string | null;
  product_id: number;
  product_name: string | null;
  started_at: string;
  ended_at: string | null;
  last_balance: number | null;
  seconds_stopped: number;
};

const BRAND_LABEL: Record<string, string> = {
  les: "Les Ailes",
  chopar: "Chopar",
};

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Number(totalSeconds) || 0);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function severityClass(totalSeconds: number): string {
  const s = Number(totalSeconds) || 0;
  if (s >= 3 * 86400) return "text-red-600 dark:text-red-400 font-semibold";
  if (s >= 86400) return "text-orange-600 dark:text-orange-400 font-medium";
  return "text-gray-600 dark:text-gray-300";
}

// "2026-08-25" -> "пн, 25 авг". Parsed as a plain calendar date: the backend
// already bucketed by Tashkent day, so no further timezone shifting here.
function fmtDayLabel(day: string): { weekday: string; date: string } {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return {
    weekday: dt.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" }),
    date: dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" }),
  };
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const StoplistByDay = () => {
  const { dateRange } = useDateRangeState();
  const [terminalsFilter] = useTerminalsFilter();
  const terminals = terminalsFilter ? terminalsFilter.toString() : undefined;

  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to)
      return { startDate: dateRange.from, endDate: dateRange.to };
    const now = new Date();
    return { startDate: now, endDate: now };
  }, [dateRange]);

  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  const daysQuery = useQuery<{ days: DayRow[] }>({
    queryKey: ["stoplist_by_day", startDate, endDate, terminals],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      if (terminals) params.set("terminals", terminals);
      const res = await fetch(`/api/stoplist/by-day?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const days = daysQuery.data?.days ?? [];

  // Keep the selection valid as the filters move: fall back to the newest day.
  const activeDay = React.useMemo(() => {
    if (selectedDay && days.some((d) => d.day === selectedDay)) return selectedDay;
    return days[0]?.day ?? null;
  }, [selectedDay, days]);

  const itemsQuery = useQuery<{ day: string; items: ItemRow[] }>({
    queryKey: ["stoplist_by_day_items", activeDay, terminals],
    enabled: !!activeDay,
    queryFn: async () => {
      const params = new URLSearchParams({ day: activeDay! });
      if (terminals) params.set("terminals", terminals);
      const res = await fetch(`/api/stoplist/by-day/items?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const items = itemsQuery.data?.items ?? [];
  const filteredItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.product_name ?? "").toLowerCase().includes(q) ||
        (i.terminal_name ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const maxStops = days.reduce((m, d) => Math.max(m, d.stops), 0) || 1;
  const totalStops = days.reduce((s, d) => s + d.stops, 0);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Стоп-лист по дням</CardTitle>
          <div className="text-xs text-muted-foreground">
            {totalStops.toLocaleString("ru-RU")} постановок в стоп за период
            {" · "}
            {/* History collection started on 2026-08-13; earlier days only hold
                the stops that were still open at the first sync. */}
            <span title="История стоп-листа собирается с 13.08.2026; более ранние дни неполные">
              полные данные с 13.08.2026
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        {/* Day column */}
        <div className="flex min-h-0 shrink-0 flex-row gap-2 overflow-x-auto md:w-56 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:pr-1">
          {daysQuery.isLoading && (
            <div className="py-6 text-center text-sm text-gray-400">Загрузка…</div>
          )}
          {daysQuery.error && (
            <div className="py-6 text-center text-sm text-red-500">
              Не удалось загрузить стоп-лист
            </div>
          )}
          {!daysQuery.isLoading && !daysQuery.error && days.length === 0 && (
            <div className="py-6 text-center text-sm text-gray-400">
              За период стопов не было
            </div>
          )}
          {days.map((d) => {
            const label = fmtDayLabel(d.day);
            const active = d.day === activeDay;
            return (
              <button
                key={d.day}
                type="button"
                onClick={() => setSelectedDay(d.day)}
                className={cn(
                  "min-w-[9rem] rounded-lg border px-3 py-2 text-left transition-colors md:min-w-0",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:bg-muted"
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {label.date}{" "}
                    <span className="text-xs text-muted-foreground">{label.weekday}</span>
                  </span>
                  <span className="text-sm font-bold tabular-nums">{d.stops}</span>
                </div>
                <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-amber-500"
                    style={{ width: `${(d.les / maxStops) * 100}%` }}
                    title={`Les Ailes: ${d.les}`}
                  />
                  <div
                    className="bg-sky-500"
                    style={{ width: `${(d.chopar / maxStops) * 100}%` }}
                    title={`Chopar: ${d.chopar}`}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {d.products} позиций · {d.terminals} филиалов
                  {d.still_open > 0 && (
                    <span className="text-red-500"> · {d.still_open} в стопе</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Items for the selected day */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по блюду или филиалу"
              className="h-8 pl-8 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Время</th>
                  <th className="px-2 py-2 font-medium">Позиция</th>
                  <th className="px-2 py-2 font-medium">Филиал</th>
                  <th className="px-2 py-2 font-medium">Бренд</th>
                  <th className="px-2 py-2 text-right font-medium">Простой</th>
                </tr>
              </thead>
              <tbody>
                {itemsQuery.isLoading && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-gray-400">
                      Загрузка…
                    </td>
                  </tr>
                )}
                {!itemsQuery.isLoading && filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-gray-400">
                      {items.length === 0 ? "В этот день стопов не было" : "Ничего не найдено"}
                    </td>
                  </tr>
                )}
                {filteredItems.map((i, idx) => (
                  <tr
                    key={`${i.brand}-${i.terminal_id}-${i.product_id}-${i.started_at}-${idx}`}
                    className="border-b last:border-0 hover:bg-muted/50"
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                      {fmtTime(i.started_at)}
                    </td>
                    <td className="px-2 py-1.5">
                      {i.product_name ?? `#${i.product_id}`}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {i.terminal_name ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          i.brand === "les"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                        )}
                      >
                        {BRAND_LABEL[i.brand] ?? i.brand}
                      </span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-2 py-1.5 text-right",
                        severityClass(i.seconds_stopped)
                      )}
                    >
                      {fmtDuration(i.seconds_stopped)}
                      {i.ended_at === null && (
                        <span className="ml-1 text-[11px] text-red-500">· ещё в стопе</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default StoplistByDay;
