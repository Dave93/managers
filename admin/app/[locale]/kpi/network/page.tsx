"use client";
import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type BranchNetwork } from "@admin/lib/kpi-api";
import { INDICATOR_LABEL, cellTone, formatFact, formatPoints, formatScore, networkAverage, tierCounts, tierTone } from "@admin/lib/kpi/branch";
import { kpiErrorText, loadErrors, outcomeKnown, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { calendarPeriod, monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import type { Tone } from "@admin/lib/kpi/status";
import { cn } from "@admin/lib/utils";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";

const CELL: Record<Tone, string> = {
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-blue-50 text-blue-800",
  gray: "text-muted-foreground",
};

const TILE: Record<Tone, string> = {
  green: "border-green-200 bg-green-50 text-green-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  gray: "border-gray-200 bg-gray-50 text-gray-700",
};

export default function NetworkPage() {
  return (
    <ScreenGate screen="network">
      <NetworkScreen />
    </ScreenGate>
  );
}

function NetworkScreen() {
  const now = useMemo(() => new Date(), []);
  const { access } = useKpiPerms();
  const me = useKpiMe();
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? me.data?.current_period ?? calendarPeriod(now);
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return base.includes(period) ? base : [period, ...base];
  }, [now, period]);

  // Без placeholderData: при смене месяца строки прошлого месяца не остаются на экране.
  const network = useQuery<BranchNetwork, Error>({
    queryKey: qk.branchNetwork(period),
    queryFn: () => kpiApi.branch.network(period),
    retry: shouldRetry,
  });
  const load = loadErrors(network);
  const data = network.data;
  const canCompute = access.manage || access.approve;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">Балл филиалов · {monthLabel(period)}</h1>
        <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={options} className="w-44" />
        {canCompute && <ComputeButton period={period} />}
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <NetworkView period={period} data={data} canCompute={canCompute} />
      )}
    </div>
  );
}

function ComputeButton({ period }: { period: string }) {
  const qc = useQueryClient();
  // Защёлка: второй тап до ответа сервера не уходит запросом.
  const latch = useRef(false);
  const compute = useMutation({
    mutationFn: (p: string) => kpiApi.branch.compute(p),
    onSuccess: async (r) => {
      toast.success(
        r.version === null ? "Данных за месяц нет: ни один филиал не посчитан" : `Посчитано филиалов: ${r.terminals}`
      );
      await qc.invalidateQueries({ queryKey: qk.branchAll });
    },
    onError: async (e) => {
      toast.error(kpiErrorText(e));
      // Исход неизвестен (сеть, 5xx): расчёт мог пройти, обновляем сеть.
      if (!outcomeKnown(e)) await qc.invalidateQueries({ queryKey: qk.branchAll });
    },
    onSettled: () => {
      latch.current = false;
    },
  });
  const run = () => {
    if (latch.current) return;
    latch.current = true;
    compute.mutate(period);
  };
  return (
    <Button type="button" className="h-11" disabled={compute.isPending} onClick={run}>
      {compute.isPending ? "Считаем…" : "Пересчитать"}
    </Button>
  );
}

function NetworkView({ period, data, canCompute }: { period: string; data: BranchNetwork; canCompute: boolean }) {
  const rows = data.rows;
  const counts = tierCounts(rows);
  const average = networkAverage(rows);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {data.version === null
          ? "За этот месяц расчёта нет"
          : `Посчитано ${formatTashkent(data.computed_at)}, версия ${data.version}`}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {data.version !== null
            ? "В расчёте нет доступных вам филиалов"
            : canCompute
              ? `Расчёта за ${monthLabel(period)} нет. Нажмите «Пересчитать»`
              : "HR ещё не считал балл за этот месяц"}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border p-3">
              <div className="text-2xl font-semibold">{formatScore(average)}</div>
              <div className="text-sm text-muted-foreground">Средний балл</div>
            </div>
            {counts.map((c) => (
              <div key={c.pct} className={cn("rounded-lg border p-3", TILE[tierTone(c.pct)])}>
                <div className="text-2xl font-semibold">{c.count}</div>
                <div className="text-sm">{c.pct}&nbsp;%</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Филиал</TableHead>
                  <TableHead className="text-right">Балл</TableHead>
                  <TableHead>Ступень</TableHead>
                  {data.indicators.map((i) => (
                    <TableHead key={i.code} className="text-right">
                      {INDICATOR_LABEL[i.code]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.terminal_id}>
                    <TableCell>
                      <Link
                        href={`/kpi/branch/${r.terminal_id}?period=${period}`}
                        className="inline-flex min-h-11 items-center underline-offset-2 hover:underline"
                      >
                        {r.terminal_name ?? "Филиал без названия"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatScore(r.score)}</TableCell>
                    <TableCell>
                      <KpiBadge tone={tierTone(r.tier_pct)}>{r.tier_pct}&nbsp;%</KpiBadge>
                    </TableCell>
                    {data.indicators.map((i) => {
                      const cell = r.cells[i.code];
                      return (
                        <TableCell
                          key={i.code}
                          title={cell && cell.points !== null ? `${formatPoints(cell.points)} балла` : undefined}
                          className={cn("text-right whitespace-nowrap", CELL[cellTone(cell)])}
                        >
                          {formatFact(cell?.fact ?? null)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            Зелёный — цель взята, жёлтый — между порогом и целью, красный — порог не взят, серый — нет данных
          </p>
        </>
      )}
    </div>
  );
}
