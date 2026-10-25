"use client";
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
      toast.success(`Пересчитано: ${fresh.length}`);
    },
    onError: (e) => toast.error(kpiErrorText(e)),
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
      toast.error(kpiErrorText(e));
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
        <h1 className="mr-2 text-xl font-semibold">Повышения</h1>
        <Select value={quarter} onValueChange={setQuarter}>
          <SelectTrigger className="w-48" aria-label="Квартал">
            <SelectValue placeholder="Квартал" />
          </SelectTrigger>
          <SelectContent>
            {options.map((q) => (
              <SelectItem key={q} value={q}>
                {quarterLabel(q)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {access.approve && (
          <>
            <Button type="button" className="h-11" disabled={compute.isPending} onClick={() => compute.mutate()}>
              Пересчитать
            </Button>
            <Button type="button" variant="outline" className="h-11" disabled={csvBusy} onClick={exportCsv}>
              Выгрузить CSV
            </Button>
          </>
        )}
      </div>

      {meLoad.blocking != null && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(meLoad.blocking)}
        </p>
      )}

      {listLoad.blocking == null && stale != null && <StaleNote error={stale} />}

      {listLoad.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(listLoad.blocking)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {access.approve ? "За квартал нет расчёта. Нажмите «Пересчитать»." : "HR ещё не считал повышения за этот квартал"}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Карта</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {monthLabel(m).slice(0, 3)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Средняя</TableHead>
                <TableHead className="text-right">Предложение</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Решение</TableHead>
                {access.approve && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const st = RAISE_STATUS[r.status];
                const decided = r.status === "approved" || r.status === "rejected";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.employee_name}</TableCell>
                    <TableCell>{r.terminal_name ?? "—"}</TableCell>
                    <TableCell>{r.card_title ?? "—"}</TableCell>
                    {months.map((m) => (
                      <TableCell key={m} className="text-right">
                        {formatPct(r.months.find((x) => x.period === m)?.score_pct ?? null)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatPct(r.avg_pct)}</TableCell>
                    <TableCell className="text-right">{formatSum(r.suggested_amount)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <KpiBadge tone={st.tone}>{st.label}</KpiBadge>
                        {r.stale && <KpiBadge tone="amber">устарело</KpiBadge>}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-48 text-sm">
                      {decided ? (
                        <div className="space-y-0.5">
                          <div>{r.status === "approved" ? formatSum(r.approved_amount) : "Отказано"}</div>
                          <div className="text-xs text-muted-foreground">{r.decided_by_name ?? "—"}</div>
                          {r.comment && <div className="whitespace-pre-wrap break-words text-xs">{r.comment}</div>}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {access.approve && (
                      <TableCell>
                        <Button type="button" variant="outline" className="h-11" disabled={cap === undefined} onClick={() => setDecideId(r.id)}>
                          Решение
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
