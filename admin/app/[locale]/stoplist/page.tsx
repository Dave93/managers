"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@admin/components/ui/tabs";

// The stoplist endpoints live on a widened (non-Eden) controller, so this page
// talks to them with plain same-origin fetch — Next.js rewrites proxy /api/*
// to the backend and the session cookie rides along.
type CurrentRow = {
  brand: string;
  product_id: number;
  product_name: string | null;
  started_at: string;
  seconds_stopped: number;
};
type ChronicRow = {
  product_id: number;
  product_name: string | null;
  times_stopped: number;
  seconds_stopped: number;
};
type DailyRow = { day: string; stops: number; releases: number };
type ManagerStoplist = {
  current: CurrentRow[];
  chronic: ChronicRow[];
  daily: DailyRow[];
  iiko_id: string | null;
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
  return "text-gray-700 dark:text-gray-300";
}

const PERIODS = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

function TerminalStoplist({ terminalId }: { terminalId: string }) {
  const [days, setDays] = useState("30");
  const { data, isLoading, error } = useQuery<ManagerStoplist>({
    queryKey: ["stoplist_manager", terminalId, days],
    queryFn: async () => {
      const res = await fetch(
        `/api/stoplist/manager?terminal_id=${terminalId}&days=${days}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const totalHours = useMemo(() => {
    if (!data?.chronic) return 0;
    return Math.round(
      data.chronic.reduce((acc, r) => acc + (Number(r.seconds_stopped) || 0), 0) / 3600
    );
  }, [data]);

  if (isLoading)
    return (
      <div className="py-10 text-center text-gray-400">Загрузка стоп-листа…</div>
    );
  if (error)
    return (
      <div className="py-10 text-center text-red-500">
        Не удалось загрузить данные стоп-листа
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-6 pb-24">
      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-2 pt-3">
        <div className="rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold">{data.current.length}</div>
          <div className="text-xs text-gray-500">в стопе сейчас</div>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold">
            {data.current.filter((r) => Number(r.seconds_stopped) >= 86400).length}
          </div>
          <div className="text-xs text-gray-500">дольше суток</div>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold">{totalHours}</div>
          <div className="text-xs text-gray-500">часов простоя за период</div>
        </div>
      </div>

      {/* Current stops */}
      <div>
        <div className="text-xl font-bold border-b-2 pb-1 flex items-center justify-between">
          <span>Сейчас в стопе</span>
        </div>
        {data.current.length === 0 ? (
          <div className="py-6 text-center text-green-600">
            🎉 Стоп-лист пуст — всё в продаже
          </div>
        ) : (
          <div className="divide-y">
            {data.current.map((r) => (
              <div
                key={`${r.product_id}`}
                className="flex items-center justify-between py-2 gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate">{r.product_name ?? `#${r.product_id}`}</div>
                  <div className="text-xs text-gray-400">
                    с {new Date(r.started_at).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className={`shrink-0 text-sm ${severityClass(r.seconds_stopped)}`}>
                  {fmtDuration(r.seconds_stopped)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chronic products */}
      <div>
        <div className="flex items-center justify-between border-b-2 pb-1">
          <div className="text-xl font-bold">Проблемные продукты</div>
          <div className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setDays(p.value)}
                className={`px-2 py-1 text-xs rounded-md border ${
                  days === p.value
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-gray-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {data.chronic.length === 0 ? (
          <div className="py-6 text-center text-gray-400">
            За период стопов не было
          </div>
        ) : (
          <div className="divide-y">
            {data.chronic.map((r) => (
              <div
                key={`${r.product_id}`}
                className="flex items-center justify-between py-2 gap-2"
              >
                <div className="min-w-0 truncate">
                  {r.product_name ?? `#${r.product_id}`}
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-sm ${severityClass(r.seconds_stopped)}`}>
                    {fmtDuration(r.seconds_stopped)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {r.times_stopped}× за период
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily trend */}
      {data.daily.length > 0 && (
        <div>
          <div className="text-xl font-bold border-b-2 pb-1">
            Постановки в стоп по дням
          </div>
          <div className="flex items-end gap-1 h-24 pt-3 overflow-x-auto">
            {data.daily.map((d) => {
              const max = Math.max(...data.daily.map((x) => x.stops), 1);
              return (
                <div
                  key={d.day}
                  className="flex flex-col items-center gap-1 min-w-[26px]"
                  title={`${d.day}: ${d.stops} стопов, ${d.releases} снятий`}
                >
                  <div className="text-[10px] text-gray-500">{d.stops || ""}</div>
                  <div
                    className="w-4 rounded-t bg-blue-500/80"
                    style={{ height: `${Math.max((d.stops / max) * 60, d.stops > 0 ? 4 : 1)}px` }}
                  />
                  <div className="text-[9px] text-gray-400 rotate-0">
                    {d.day.slice(8, 10)}.{d.day.slice(5, 7)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StoplistPage() {
  const [{ data: terminalsList, isLoading }] = useQueries({
    queries: [
      {
        queryKey: ["users_terminals"],
        queryFn: async () => {
          const { data } = await apiClient.api.users_terminals.my_terminals.get();
          return data;
        },
      },
    ],
  });

  const terminals: { terminal_id: string; terminals: { name: string } }[] =
    terminalsList && Array.isArray((terminalsList as any).data)
      ? (terminalsList as any).data
      : [];

  return (
    <div className="container">
      <div className="font-bold text-2xl text-center py-4">Стоп-лист</div>
      {isLoading ? (
        <div className="py-10 text-center text-gray-400">Загрузка…</div>
      ) : terminals.length === 0 ? (
        <div className="py-10 text-center text-gray-400">
          За вами не закреплён ни один филиал
        </div>
      ) : (
        <Tabs defaultValue={terminals[0].terminal_id} className="w-full">
          <TabsList className="w-full">
            {terminals.map((t) => (
              <TabsTrigger
                value={t.terminal_id}
                key={t.terminal_id}
                className="w-full"
              >
                {t.terminals.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {terminals.map((t) => (
            <TabsContent value={t.terminal_id} key={t.terminal_id}>
              <TerminalStoplist terminalId={t.terminal_id} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
