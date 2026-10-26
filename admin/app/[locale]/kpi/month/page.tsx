"use client";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
        <h1 className="mr-2 text-xl font-semibold">Месяц</h1>
        <PeriodSelect value={period} onChange={(v) => setPicked(v)} options={options} className="w-44" />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : !data || !period ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <SummaryView period={period} data={data} canApprove={access.approve} />
      )}
    </div>
  );
}

function SummaryView({ period, data, canApprove }: { period: string; data: PeriodSummary; canApprove: boolean }) {
  const st = PERIOD_STATUS[data.status];
  const c = data.counts;
  const tiles: { label: string; value: number; href?: string }[] = [
    { label: "Сотрудников", value: c.employees },
    { label: "Отправлено", value: c.submitted },
    { label: "Черновики", value: c.drafts },
    { label: "Нет оценки", value: c.none },
    { label: "С опозданием", value: c.late },
    { label: "Открытые споры", value: c.open_disputes, href: "/kpi/disputes" },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-medium">{monthLabel(period)}</span>
          <KpiBadge tone={st.tone}>{st.label}</KpiBadge>
        </div>
        {data.status === "closed" && (
          <p className="text-sm text-muted-foreground">
            Закрыл {data.closed_by_name ?? "—"} {formatTashkent(data.closed_at)}
          </p>
        )}
      </div>

      <ul className="space-y-1 text-sm">
        <li>Отправка оценок с {formatTashkent(data.deadlines.submit_opens_at)}</li>
        <li>Срок оценок {formatTashkent(data.deadlines.review_deadline)}</li>
        <li>Споры до {formatTashkent(data.deadlines.dispute_deadline)}</li>
      </ul>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => {
          const body = (
            <>
              <div className="text-2xl font-semibold">{t.value}</div>
              <div className="text-sm text-muted-foreground">{t.label}</div>
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-lg border p-3 hover:bg-muted/50">
              {body}
            </Link>
          ) : (
            <div key={t.label} className="rounded-lg border p-3">
              {body}
            </div>
          );
        })}
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-medium">Кто не оценил</h2>
        {data.unassigned > 0 && (
          <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
            Без оценщика: {data.unassigned}. Этих сотрудников некому оценить — назначьте оценщика в настройках, вкладка «Оценщики».
          </p>
        )}
        {data.lagging.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {data.unassigned > 0 ? "Назначенные оценщики отправили все оценки" : "Все оценщики отправили оценки"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Оценщик</TableHead>
                  <TableHead className="text-right">Не отправлено</TableHead>
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

      {canApprove && <MonthActions key={period} period={period} data={data} />}
    </div>
  );
}

function MonthActions({ period, data }: { period: string; data: PeriodSummary }) {
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
      return done(s, "Месяц закрыт");
    },
    onError: (e) => {
      setDisputesBlock(e instanceof KpiApiError && e.code === "open_disputes");
      toast.error(kpiErrorText(e));
    },
  });

  const reopen = useMutation({
    mutationFn: () => kpiApi.periods.reopen(period, comment.trim()),
    onSuccess: async (s) => {
      setReopenOpen(false);
      setComment("");
      await done(s, "Месяц открыт заново");
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  return (
    <div className="space-y-2">
      {data.status === "open" && (
        <div className="space-y-2">
          <Button type="button" className="h-11" disabled={!data.can_close || close.isPending} onClick={() => setConfirmOpen(true)}>
            Закрыть месяц
          </Button>
          {!data.can_close && data.close_blockers.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {data.close_blockers.map((code) => (
                <li key={code}>{codeText(code)}</li>
              ))}
            </ul>
          )}
          {disputesBlock && (
            <Link href="/kpi/disputes" className="text-sm underline">
              К спорам
            </Link>
          )}
        </div>
      )}

      {data.status === "closed" && (
        <Button type="button" variant="outline" className="h-11" onClick={() => setReopenOpen(true)}>
          Открыть заново
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть {monthLabel(period)}?</AlertDialogTitle>
            <AlertDialogDescription>После закрытия оценку меняет только HR с причиной</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => close.mutate()}>Закрыть месяц</AlertDialogAction>
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
            <DialogTitle>Открыть {monthLabel(period)} заново</DialogTitle>
            <DialogDescription>Укажите причину: она сохранится в журнале месяца</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={comment}
            disabled={reopen.isPending}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Причина"
            placeholder="Причина"
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={reopen.isPending} onClick={() => setReopenOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={reopen.isPending || !commentOk(comment, 1)}
              onClick={() => reopen.mutate()}
            >
              Открыть заново
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
