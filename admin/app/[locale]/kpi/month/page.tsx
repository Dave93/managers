"use client";
import React, { useMemo, useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Textarea } from "@admin/components/ui/textarea";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type PeriodSummary } from "@admin/lib/kpi-api";
import { KpiApiError, codeText, kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import { commentOk } from "@admin/lib/kpi/review-form";
import { PERIOD_STATUS } from "@admin/lib/kpi/status";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";

export default function MonthPage() {
  return (
    <ScreenGate screen="month">
      <MonthScreen />
    </ScreenGate>
  );
}

function MonthScreen() {
  const t = useTranslations("kpiScreens.month");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const now = useMemo(() => new Date(), []);
  const { access } = useKpiPerms();
  const me = useKpiMe();
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? me.data?.current_period ?? null;
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return period && !base.includes(period) ? [period, ...base] : base;
  }, [now, period]);

  const summary = useQuery<PeriodSummary, Error>({
    queryKey: qk.period(period ?? ""),
    queryFn: () => kpiApi.periods.get(period!),
    enabled: period !== null,
    retry: shouldRetry,
  });

  // Ошибка заменяет сводку, только пока данных нет; сбой фонового обновления — предупреждение над сводкой.
  const load = loadErrors(me, summary);
  const data = summary.data;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{t("title")}</h1>
        <PeriodSelect value={period} onChange={(v) => setPicked(v)} options={options} className="w-44" />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking, tk)}
        </p>
      ) : !data || !period ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <SummaryView period={period} data={data} canApprove={access.approve} seesLagging={access.approve || access.manage} />
      )}
    </div>
  );
}

// seesLagging: отстающих сервер считает только для approve/manage; остальным пустой список не значит «все отправили».
function SummaryView({
  period,
  data,
  canApprove,
  seesLagging,
}: {
  period: string;
  data: PeriodSummary;
  canApprove: boolean;
  seesLagging: boolean;
}) {
  const t = useTranslations("kpiScreens.month");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const st = PERIOD_STATUS[data.status];
  const c = data.counts;
  const tiles: { key: string; label: string; value: number; href?: string }[] = [
    { key: "employees", label: t("tiles.employees"), value: c.employees },
    { key: "submitted", label: t("tiles.submitted"), value: c.submitted },
    { key: "drafts", label: t("tiles.drafts"), value: c.drafts },
    { key: "none", label: t("tiles.none"), value: c.none },
    { key: "late", label: t("tiles.late"), value: c.late },
    { key: "openDisputes", label: t("tiles.openDisputes"), value: c.open_disputes, href: "/kpi/disputes" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-medium">{monthLabel(period, locale)}</span>
          <KpiBadge tone={st.tone}>{tk(st.labelKey)}</KpiBadge>
        </div>
        {data.status === "closed" && (
          <p className="text-sm text-muted-foreground">
            {t("closedBy", { name: data.closed_by_name ?? "—", date: formatTashkent(data.closed_at) })}
          </p>
        )}
      </div>

      <ul className="space-y-1 text-sm">
        <li>{t("submitOpens", { date: formatTashkent(data.deadlines.submit_opens_at) })}</li>
        <li>{t("reviewDeadline", { date: formatTashkent(data.deadlines.review_deadline) })}</li>
        <li>{t("disputeDeadline", { date: formatTashkent(data.deadlines.dispute_deadline) })}</li>
      </ul>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => {
          const body = (
            <>
              <div className="text-2xl font-semibold">{tile.value}</div>
              <div className="text-sm text-muted-foreground">{tile.label}</div>
            </>
          );
          return tile.href ? (
            <Link key={tile.key} href={tile.href} className="rounded-lg border p-3 hover:bg-muted/50">
              {body}
            </Link>
          ) : (
            <div key={tile.key} className="rounded-lg border p-3">
              {body}
            </div>
          );
        })}
      </div>

      {seesLagging && (
        <section className="space-y-2">
          <h2 className="text-base font-medium">{t("laggingTitle")}</h2>
          {data.unassigned > 0 && (
            <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              {t("unassigned", { count: data.unassigned })}
            </p>
          )}
          {data.lagging.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.unassigned > 0 ? t("assignedAllSent") : t("allSent")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colReviewer")}</TableHead>
                    <TableHead className="text-right">{t("colPending")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lagging.map((l) => (
                    <TableRow key={l.user_id}>
                      <TableCell>{l.user_name}</TableCell>
                      <TableCell className="text-right">{l.pending}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {canApprove && <MonthActions key={period} period={period} data={data} />}
    </div>
  );
}

function MonthActions({ period, data }: { period: string; data: PeriodSummary }) {
  const t = useTranslations("kpiScreens.month");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [disputesBlock, setDisputesBlock] = useState(false);

  const done = async (summary: PeriodSummary, message: string) => {
    qc.setQueryData(qk.period(period), summary);
    await Promise.all([qk.employeesAll, qk.formAll, qk.raisesAll].map((queryKey) => qc.invalidateQueries({ queryKey })));
    toast.success(message);
  };

  const close = useMutation({
    mutationFn: () => kpiApi.periods.close(period),
    onSuccess: (s) => {
      setDisputesBlock(false);
      return done(s, t("monthClosed"));
    },
    onError: (e) => {
      setDisputesBlock(e instanceof KpiApiError && e.code === "open_disputes");
      toast.error(kpiErrorText(e, tk));
    },
  });

  const reopen = useMutation({
    mutationFn: () => kpiApi.periods.reopen(period, comment.trim()),
    onSuccess: async (s) => {
      setReopenOpen(false);
      setComment("");
      await done(s, t("monthReopened"));
    },
    onError: (e) => toast.error(kpiErrorText(e, tk)),
  });

  return (
    <div className="space-y-2">
      {data.status === "open" && (
        <div className="space-y-2">
          <Button type="button" className="h-11" disabled={!data.can_close || close.isPending} onClick={() => setConfirmOpen(true)}>
            {t("closeMonth")}
          </Button>
          {!data.can_close && data.close_blockers.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {data.close_blockers.map((code) => (
                <li key={code}>{codeText(code, tk)}</li>
              ))}
            </ul>
          )}
          {disputesBlock && (
            <Link href="/kpi/disputes" className="text-sm underline">
              {t("toDisputes")}
            </Link>
          )}
        </div>
      )}

      {data.status === "closed" && (
        <Button type="button" variant="outline" className="h-11" onClick={() => setReopenOpen(true)}>
          {t("reopen")}
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmCloseTitle", { month: monthLabel(period, locale) })}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmCloseDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => close.mutate()}>{t("closeMonth")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={reopenOpen}
        onOpenChange={(o) => {
          if (!reopen.isPending) setReopenOpen(o);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reopenTitle", { month: monthLabel(period, locale) })}</DialogTitle>
            <DialogDescription>{t("reopenDescription")}</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={comment}
            disabled={reopen.isPending}
            onChange={(e) => setComment(e.target.value)}
            aria-label={t("reason")}
            placeholder={t("reason")}
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={reopen.isPending} onClick={() => setReopenOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={reopen.isPending || !commentOk(comment, 1)}
              onClick={() => reopen.mutate()}
            >
              {t("reopen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
