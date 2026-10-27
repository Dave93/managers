"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type ViolationRow } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL, terminalOptions } from "@admin/lib/kpi/filters";
import { formatTashkent } from "@admin/lib/kpi/format";
import { calendarPeriod, periodOptions } from "@admin/lib/kpi/periods";
import { VIOLATION_STATUS } from "@admin/lib/kpi/status";
import { KpiBadge } from "../_components/kpi-badge";
import { OpenDisputeDialog } from "../_components/open-dispute-dialog";
import { PeriodSelect } from "../_components/period-select";
import { PhotoThumbs } from "../_components/photo-thumbs";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";
import { CancelViolationDialog } from "./_components/cancel-dialog";

type StatusFilter = "active" | "cancelled" | typeof ALL;

export default function ViolationsPage() {
  return (
    <ScreenGate screen="violations">
      <ViolationsScreen />
    </ScreenGate>
  );
}

function ViolationsScreen() {
  const now = useMemo(() => new Date(), []);
  const me = useKpiMe();
  const { access } = useKpiPerms();
  const [period, setPeriod] = useState(() => calendarPeriod(now));
  const [terminal, setTerminal] = useState<string>(ALL);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  // Храним id: после отмены или спора список обновляется, и диалог берёт свежую строку.
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);

  const options = useMemo(() => {
    const list = periodOptions(now, 6);
    return list.includes(period) ? list : [period, ...list];
  }, [now, period]);

  const list = useQuery({
    queryKey: qk.violations({ period }),
    queryFn: () => kpiApi.violations.list({ period }),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const terminals = useMemo(() => terminalOptions(rows), [rows]);
  const visible = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((v) => {
      if (terminal !== ALL && v.terminal_id !== terminal) return false;
      if (status !== ALL && v.status !== status) return false;
      if (words.length) {
        const name = v.employee_name.toLowerCase();
        if (!words.every((w) => name.includes(w))) return false;
      }
      return true;
    });
  }, [rows, terminal, status, search]);

  const userId = me.data?.user_id;
  // Оспоренное нарушение снимает только разбор спора (сервер ответит open_dispute).
  const canCancel = (v: ViolationRow) =>
    v.status === "active" &&
    !v.open_dispute &&
    (access.approve || (access.evaluate && userId !== undefined && v.recorded_by === userId));
  // После отклонённого спора повторный нельзя (сервер ответит dispute_rejected).
  const canDispute = (v: ViolationRow) =>
    v.status === "active" && !v.open_dispute && !v.dispute_rejected && (access.evaluate || access.approve);

  const cancelRow = cancelId ? rows.find((v) => v.id === cancelId) ?? null : null;
  const disputeRow = disputeId ? rows.find((v) => v.id === disputeId) ?? null : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">Нарушения</h1>
        <PeriodSelect
          value={period}
          onChange={(v) => {
            if (!v) return;
            setPeriod(v);
            // Филиалы берутся из строк месяца: выбранного в новом месяце может не быть.
            setTerminal(ALL);
          }}
          options={options}
          className="w-44"
        />
        {access.evaluate && (
          <Button asChild className="h-11 sm:ml-auto">
            <Link href="/kpi/violations/new">Зафиксировать</Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени"
          aria-label="Поиск по имени"
          className="w-full sm:w-56"
        />
        <Select value={terminal} onValueChange={setTerminal}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Филиал">
            <SelectValue placeholder="Филиал" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все филиалы</SelectItem>
            {terminals.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Статус">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Действует</SelectItem>
            <SelectItem value="cancelled">Отменено</SelectItem>
            <SelectItem value={ALL}>Все</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Ошибка заменяет список, только пока данных нет; сбой фонового обновления — предупреждение над списком. */}
      {list.error != null && list.data !== undefined && <StaleNote error={list.error} />}

      {list.error != null && list.data === undefined ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">За этот месяц нарушений нет.</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">По выбранным фильтрам ничего нет.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((v) => {
            const st = VIOLATION_STATUS[v.status];
            return (
              <li key={v.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">{formatTashkent(v.occurred_at)}</span>
                  <KpiBadge tone={st.tone}>{st.label}</KpiBadge>
                  {v.open_dispute && <KpiBadge tone="amber">Спор</KpiBadge>}
                </div>
                <div>
                  <div className="font-medium">{v.employee_name}</div>
                  <div className="text-sm text-muted-foreground">{v.terminal_name ?? "Филиал без названия"}</div>
                </div>
                <div className="text-sm">{v.item_title_ru ?? "Без пункта"}</div>
                <p className="whitespace-pre-wrap break-words text-sm">{v.comment}</p>
                <PhotoThumbs photos={v.photos} size="md" />
                <div className="text-xs text-muted-foreground">Записал: {v.recorded_by_name ?? "—"}</div>
                {v.status === "active" && v.dispute_rejected && (
                  <p className="text-sm text-muted-foreground">Спор отклонён. Повторно оспорить нельзя</p>
                )}
                {v.status === "cancelled" && v.cancel_reason && (
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">Причина отмены: {v.cancel_reason}</p>
                )}
                {(canCancel(v) || canDispute(v)) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {canDispute(v) && (
                      <Button type="button" variant="outline" className="h-11" onClick={() => setDisputeId(v.id)}>
                        Оспорить
                      </Button>
                    )}
                    {canCancel(v) && (
                      <Button type="button" variant="outline" className="h-11" onClick={() => setCancelId(v.id)}>
                        Отменить
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CancelViolationDialog violation={cancelRow} onClose={() => setCancelId(null)} />
      <OpenDisputeDialog
        subject={
          disputeRow
            ? { type: "violation", id: disputeRow.id, title: `${disputeRow.employee_name}, ${formatTashkent(disputeRow.occurred_at)}: ${disputeRow.comment}` }
            : null
        }
        commentMin={me.data?.settings.change_comment_min ?? 5}
        onClose={() => setDisputeId(null)}
      />
    </div>
  );
}
