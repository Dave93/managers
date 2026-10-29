"use client";
import React, { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type BranchCell, type BranchNetwork } from "@admin/lib/kpi-api";
import {
  INDICATOR_LABEL_KEY,
  cellTone,
  coverageText,
  defaultBranchPeriod,
  formatFact,
  formatPoints,
  formatScore,
  monthIncomplete,
  newDataHint,
  networkAverage,
  tierCounts,
  tierTone,
} from "@admin/lib/kpi/branch";
import { kpiErrorText, loadErrors, outcomeKnown, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import type { Tone } from "@admin/lib/kpi/status";
import { cn } from "@admin/lib/utils";
import { KpiBadge } from "../_components/kpi-badge";
import { NewDataNote } from "../_components/new-data-note";
import { PeriodSelect } from "../_components/period-select";
import { PreliminaryNote } from "../_components/preliminary-note";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiPerms } from "../_components/use-kpi";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

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
  const tc = useTranslations("kpiScreens.common");
  return (
    <ScreenGate screen="network">
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{tc("loading")}</p>}>
        <NetworkScreen />
      </Suspense>
    </ScreenGate>
  );
}

function NetworkScreen() {
  const t = useTranslations("kpiScreens.network");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const now = useMemo(() => new Date(), []);
  const { access } = useKpiPerms();
  const asked = useSearchParams().get("period");
  const [picked, setPicked] = useState<string | null>(null);
  // Месяц из адреса (ссылка «К пересчёту» с экрана филиала), иначе последний завершённый:
  // текущий ещё не прожит, балл по нему предварительный
  const period = picked ?? (asked && PERIOD_RE.test(asked) ? asked : defaultBranchPeriod(now));
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
        <h1 className="mr-2 text-xl font-semibold">{t("title", { month: monthLabel(period, locale) })}</h1>
        <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={options} className="w-44" />
        {canCompute && <ComputeButton period={period} />}
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking, tk)}
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <NetworkView period={period} data={data} canCompute={canCompute} />
      )}
    </div>
  );
}

function ComputeButton({ period }: { period: string }) {
  const t = useTranslations("kpiScreens.network");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Защёлка: второй тап до ответа сервера не уходит запросом.
  const latch = useRef(false);
  const compute = useMutation({
    mutationFn: (p: string) => kpiApi.branch.compute(p),
    onSuccess: async (r) => {
      toast.success(
        r.version === null ? t("noDataToast") : t("computedBranches", { count: r.terminals })
      );
      await qc.invalidateQueries({ queryKey: qk.branchAll });
    },
    onError: async (e) => {
      toast.error(kpiErrorText(e, tk));
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
  // Текущий месяц (на момент нажатия): сначала подтверждение, что результат будет предварительным
  const onClick = () => {
    if (latch.current) return;
    if (monthIncomplete(period, new Date())) setConfirmOpen(true);
    else run();
  };
  return (
    <>
      <Button type="button" className="h-11" disabled={compute.isPending} onClick={onClick}>
        {compute.isPending ? t("computing") : t("recompute")}
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle", { month: monthLabel(period, locale) })}</AlertDialogTitle>
            <AlertDialogDescription>{tk("lib.branch.computeConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={run}>
              {t("calculate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NetworkView({ period, data, canCompute }: { period: string; data: BranchNetwork; canCompute: boolean }) {
  const t = useTranslations("kpiScreens.network");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const rows = data.rows;
  const counts = tierCounts(rows);
  const average = networkAverage(rows);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {data.version === null
          ? t("noCalcThisMonth")
          : t("computedVersion", { date: formatTashkent(data.computed_at), version: data.version })}
      </p>

      {data.version !== null && data.preliminary && <PreliminaryNote />}

      {(() => {
        const hint = newDataHint(data, { canCompute, period, onNetwork: true }, tk);
        return hint ? <NewDataNote text={hint.text} href={hint.href} /> : null;
      })()}

      {rows.length === 0 ? (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">
          {data.version !== null
            ? t("noAccessibleBranches")
            : canCompute
              ? t("noCalcFor", { month: monthLabel(period, locale) })
              : t("hrNotCalculated")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border p-3">
              <div className="text-2xl font-semibold">{formatScore(average)}</div>
              <div className="text-sm text-muted-foreground">{t("averageScore")}</div>
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
                  <TableHead>{t("colBranch")}</TableHead>
                  <TableHead className="text-right">{t("colScore")}</TableHead>
                  <TableHead>{t("colTier")}</TableHead>
                  {data.columns.map((code) => (
                    <TableHead key={code} className="text-right">
                      {Object.hasOwn(INDICATOR_LABEL_KEY, code) ? tk(INDICATOR_LABEL_KEY[code]) : code}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const coverage = coverageText(Object.values(r.cells).filter((c): c is BranchCell => c !== undefined), tk);
                  return (
                    <TableRow key={r.terminal_id}>
                      <TableCell>
                        <Link
                          href={`/kpi/branch/${r.terminal_id}?period=${period}`}
                          className="inline-flex min-h-11 items-center underline-offset-2 hover:underline"
                        >
                          {r.terminal_name ?? t("unnamedBranch")}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="font-medium">{formatScore(r.score)}</div>
                        {coverage !== "" && <div className="text-xs text-muted-foreground">{coverage}</div>}
                      </TableCell>
                      <TableCell>
                        <KpiBadge tone={tierTone(r.tier_pct)}>{r.tier_pct}&nbsp;%</KpiBadge>
                      </TableCell>
                      {data.columns.map((code) => {
                        const cell = r.cells[code];
                        return (
                          <TableCell
                            key={code}
                            title={cell && cell.points !== null ? t("pointsTitle", { points: formatPoints(cell.points) }) : undefined}
                            className={cn("text-right whitespace-nowrap", CELL[cellTone(cell)])}
                          >
                            {formatFact(cell?.fact ?? null, tk)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("legend")}
          </p>
        </>
      )}
    </div>
  );
}
