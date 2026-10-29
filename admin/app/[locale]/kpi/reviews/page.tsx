"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { cn } from "@admin/lib/utils";
import { kpiApi } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import {
  ALL,
  cardOptions,
  employeeName,
  filterRows,
  statusCounts,
  terminalOptions,
  type RowFilter,
} from "@admin/lib/kpi/filters";
import { formatPct, formatTashkent } from "@admin/lib/kpi/format";
import { calendarPeriod, periodOptions } from "@admin/lib/kpi/periods";
import { ROW_STATUS, rowStatus, type RowStatus } from "@admin/lib/kpi/status";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";
import { ReviewSheet } from "./_components/review-sheet";

const STATUS_ORDER: RowStatus[] = ["none", "draft", "submitted", "disputed"];

export default function ReviewsPage() {
  return (
    <ScreenGate screen="reviews">
      <ReviewsScreen />
    </ScreenGate>
  );
}

function ReviewsScreen() {
  const t = useTranslations("kpiScreens.reviews");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const now = useMemo(() => new Date(), []);
  const me = useKpiMe();
  const { access } = useKpiPerms();
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>({ terminal_id: ALL, card_id: ALL, status: ALL, search: "" });
  // Храним id, а не строку: после сохранения список обновляется, и панель берёт свежую строку.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const currentPeriod = me.data?.current_period ?? calendarPeriod(now);
  const period = picked ?? currentPeriod;
  const options = useMemo(() => {
    const list = periodOptions(now, 6);
    return list.includes(period) ? list : [period, ...list];
  }, [now, period]);

  const employees = useQuery({
    queryKey: qk.employees({ period }),
    queryFn: () => kpiApi.employees.list({ period }),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => employees.data ?? [], [employees.data]);
  // Пока на экране данные прошлого месяца (placeholder), панель не открываем: форма ушла бы в новый период с чужой строкой.
  const placeholder = employees.isPlaceholderData;
  const selected = useMemo(
    () => (placeholder || selectedId === null ? null : rows.find((r) => r.id === selectedId) ?? null),
    [placeholder, rows, selectedId]
  );
  const terminals = useMemo(() => terminalOptions(rows, tk), [rows]);
  const cards = useMemo(() => cardOptions(rows), [rows]);
  const counts = useMemo(() => statusCounts(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, filter), [rows, filter]);

  const set = (patch: Partial<RowFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const open = (id: string) => {
    if (!placeholder) setSelectedId(id);
  };
  const deadlines = me.data && period === me.data.current_period ? me.data.deadlines : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{t("title")}</h1>
        <PeriodSelect
          value={period}
          onChange={(v) => {
            setPicked(v);
            setSelectedId(null);
            // Филиалы и карты берутся из строк месяца: выбранного в новом месяце может не быть.
            setFilter((f) => ({ ...f, terminal_id: ALL, card_id: ALL }));
          }}
          options={options}
          className="w-44"
        />
      </div>

      {deadlines && (
        <p className="text-sm text-muted-foreground">
          {t("deadlines", {
            opens: formatTashkent(deadlines.submit_opens_at),
            deadline: formatTashkent(deadlines.review_deadline),
            disputes: formatTashkent(deadlines.dispute_deadline),
          })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => {
          const active = filter.status === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => set({ status: active ? ALL : s })}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-muted",
                active && "border-primary bg-muted font-medium"
              )}
            >
              {tk(ROW_STATUS[s].labelKey)} <span className="tabular-nums">{counts[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={filter.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder={t("searchByName")}
          aria-label={t("searchByName")}
          className="w-full sm:w-56"
        />
        <Select value={filter.terminal_id} onValueChange={(v) => set({ terminal_id: v })}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("branch")}>
            <SelectValue placeholder={t("branch")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allBranches")}</SelectItem>
            {terminals.map((tm) => (
              <SelectItem key={tm.id} value={tm.id}>
                {tm.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filter.card_id} onValueChange={(v) => set({ card_id: v })}>
          <SelectTrigger className="w-full sm:w-52" aria-label={t("card")}>
            <SelectValue placeholder={t("card")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allCards")}</SelectItem>
            {cards.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Ошибка заменяет список, только пока данных нет; сбой фонового обновления — предупреждение над списком. */}
      {employees.error != null && employees.data !== undefined && <StaleNote error={employees.error} />}

      {employees.error != null && employees.data === undefined ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(employees.error, tk)}
        </p>
      ) : employees.isPending ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{t("noEmployees")}</p>
          {access.evaluate && !access.view && (
            <div className="space-y-1">
              {me.data && me.data.scopes.length > 0 ? (
                <ul className="list-inside list-disc">
                  {me.data.scopes.map((s) => (
                    <li key={s.id}>
                      {s.card_title ?? t("anyCard")} · {s.terminal_name ?? t("anyBranch")}
                    </li>
                  ))}
                </ul>
              ) : (
                me.data && <p>{t("noAssignments")}</p>
              )}
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMatches")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colEmployee")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("colBranch")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("colCard")}</TableHead>
              <TableHead className="hidden sm:table-cell">{t("colStatus")}</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const st = ROW_STATUS[rowStatus(r)];
              const badges = (
                <>
                  <KpiBadge tone={st.tone}>{tk(st.labelKey)}</KpiBadge>
                  {r.review?.late && <KpiBadge tone="amber">{t("late")}</KpiBadge>}
                </>
              );
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  tabIndex={0}
                  data-state={selected?.id === r.id ? "selected" : undefined}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(r.id);
                    }
                  }}
                >
                  {/* Узкий экран (и планшет с открытым меню): филиал, а на телефоне и статус — под именем; «%» видна всегда.
                      Текстовые колонки переносятся, чтобы таблица не была шире карточки. */}
                  <TableCell className="whitespace-normal">
                    <div className="break-words font-medium">{employeeName(r)}</div>
                    <div className="break-words text-xs text-muted-foreground lg:hidden">{r.terminal_name ?? t("unnamedBranch")}</div>
                    <div className="mt-1 flex flex-wrap gap-1 sm:hidden">{badges}</div>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal lg:table-cell">{r.terminal_name ?? t("unnamedBranch")}</TableCell>
                  <TableCell className="hidden whitespace-normal lg:table-cell">{r.card?.title_ru ?? "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-col items-start gap-1">{badges}</div>
                  </TableCell>
                  <TableCell className="w-px text-right align-top tabular-nums sm:align-middle">
                    {formatPct(r.review?.score_pct ?? null)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ReviewSheet
        period={period}
        row={selected}
        commentMin={me.data?.settings.change_comment_min ?? 5}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
