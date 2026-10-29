"use client";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { downloadRaisesCsv, kpiApi, type RaiseRow } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatPct, formatSum } from "@admin/lib/kpi/format";
import { defaultQuarter, monthLabel, quarterLabel, quarterMonths, quarterOptions, raisesCsvFilename } from "@admin/lib/kpi/periods";
import { RAISE_STATUS } from "@admin/lib/kpi/status";
import { KpiBadge } from "../_components/kpi-badge";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";
import { DecideDialog } from "./_components/decide-dialog";

export default function RaisesPage() {
  return (
    <ScreenGate screen="raises">
      <RaisesScreen />
    </ScreenGate>
  );
}

function RaisesScreen() {
  const t = useTranslations("kpiScreens.raises");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const now = useMemo(() => new Date(), []);
  const qc = useQueryClient();
  const { access } = useKpiPerms();
  const me = useKpiMe();
  // Потолок берём только из настроек сервера: пока они не загружены, решать нельзя.
  const cap = me.data?.settings.raise_cap;
  const options = useMemo(() => quarterOptions(now, 6), [now]);
  const [quarter, setQuarter] = useState(() => defaultQuarter(now));
  const [csvBusy, setCsvBusy] = useState(false);
  // Храним id: после решения строка в списке обновляется, и диалог берёт свежую.
  const [decideId, setDecideId] = useState<string | null>(null);

  const list = useQuery<RaiseRow[], Error>({
    queryKey: qk.raises(quarter),
    queryFn: () => kpiApi.raises.list(quarter),
    retry: shouldRetry,
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  // Строку другого квартала решать нельзя: ключ запроса меняется вместе с кварталом, но id мог остаться от прошлого.
  const decideRow = decideId ? rows.find((r) => r.id === decideId && r.quarter_start === quarter) ?? null : null;

  const compute = useMutation({
    mutationFn: () => kpiApi.raises.compute(quarter),
    onSuccess: (fresh) => {
      qc.setQueryData(qk.raises(quarter), fresh);
      toast.success(t("recomputed", { count: fresh.length }));
    },
    onError: (e) => toast.error(kpiErrorText(e, tk)),
  });

  const exportCsv = async () => {
    if (csvBusy) return;
    setCsvBusy(true);
    try {
      const blob = await downloadRaisesCsv(quarter);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = raisesCsvFilename(quarter);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      toast.error(kpiErrorText(e, tk));
    } finally {
      setCsvBusy(false);
    }
  };

  const months = quarterMonths(quarter);
  // Ошибка заменяет таблицу, только пока данных нет; сбой фонового обновления — предупреждение над таблицей.
  const meLoad = loadErrors(me);
  const listLoad = loadErrors(list);
  const stale = meLoad.stale ?? listLoad.stale;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{t("title")}</h1>
        <Select value={quarter} onValueChange={setQuarter}>
          <SelectTrigger className="w-48" aria-label={t("quarter")}>
            <SelectValue placeholder={t("quarter")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((q) => (
              <SelectItem key={q} value={q}>
                {quarterLabel(q, tk)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {access.approve && (
          <>
            <Button type="button" className="h-11" disabled={compute.isPending} onClick={() => compute.mutate()}>
              {t("recompute")}
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={csvBusy} onClick={exportCsv}>
              {t("exportCsv")}
            </Button>
          </>
        )}
      </div>

      {meLoad.blocking != null && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(meLoad.blocking, tk)}
        </p>
      )}

      {listLoad.blocking == null && stale != null && <StaleNote error={stale} />}

      {listLoad.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(listLoad.blocking, tk)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {access.approve ? t("emptyApprove") : t("emptyNoApprove")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {/* ФИО прилипает слева, «Решение» справа: узкое окно прокручивает середину, а имя и кнопка остаются на месте.
                    Фон непрозрачный (токен темы) и z-index выше соседних ячеек, ничего не просвечивает. */}
                <TableHead className="sticky left-0 z-20 bg-background">{t("colName")}</TableHead>
                <TableHead>{t("colBranch")}</TableHead>
                <TableHead>{t("colCard")}</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {monthLabel(m, locale).slice(0, 3)}
                  </TableHead>
                ))}
                <TableHead className="text-right">{t("colAverage")}</TableHead>
                <TableHead className="text-right">{t("colSuggested")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colDecision")}</TableHead>
                {access.approve && (
                  <TableHead className="sticky right-0 z-20 bg-background">
                    <span className="sr-only">{t("colActions")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = RAISE_STATUS[r.status];
                const decided = r.status === "approved" || r.status === "rejected";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="sticky left-0 z-10 min-w-28 whitespace-normal bg-background font-medium">{r.employee_name}</TableCell>
                    <TableCell className="min-w-28 whitespace-normal">{r.terminal_name ?? "—"}</TableCell>
                    <TableCell className="min-w-28 whitespace-normal">{r.card_title ?? "—"}</TableCell>
                    {months.map((m) => (
                      <TableCell key={m} className="text-right">
                        {formatPct(r.months.find((x) => x.period === m)?.score_pct ?? null)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatPct(r.avg_pct)}</TableCell>
                    <TableCell className="text-right">{formatSum(r.suggested_amount, tk)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <KpiBadge tone={st.tone}>{tk(st.labelKey)}</KpiBadge>
                        {r.stale && <KpiBadge tone="amber">{t("stale")}</KpiBadge>}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-40 text-sm">
                      {decided ? (
                        <div className="space-y-0.5">
                          <div>{r.status === "approved" ? formatSum(r.approved_amount, tk) : t("refused")}</div>
                          <div className="text-xs text-muted-foreground">{r.decided_by_name ?? "—"}</div>
                          {r.comment && <div className="whitespace-pre-wrap break-words text-xs">{r.comment}</div>}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {access.approve && (
                      <TableCell className="sticky right-0 z-10 bg-background">
                        <Button type="button" variant="outline" className="h-11" disabled={cap === undefined} onClick={() => setDecideId(r.id)}>
                          {t("decideButton")}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <DecideDialog row={access.approve && cap !== undefined ? decideRow : null} cap={cap ?? 0} onClose={() => setDecideId(null)} />
    </div>
  );
}
