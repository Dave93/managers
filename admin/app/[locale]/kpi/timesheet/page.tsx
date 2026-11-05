"use client";
import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Skeleton } from "@admin/components/ui/skeleton";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type AttendanceBoard } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL } from "@admin/lib/kpi/filters";
import { calendarPeriod, monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import {
  absentShare,
  branchStats,
  filterBoard,
  formatShare,
  groupByTerminal,
  lateShare,
  sumTotals,
  tabCounts,
  tashkentToday,
  totalsOf,
  type Tab,
} from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../_components/use-kpi";
import { CELL } from "../_components/day-style";
import { EmployeeList } from "./_components/employee-list";
import { EmployeeSheet } from "./_components/employee-sheet";
import { MonthMatrix } from "./_components/month-matrix";
import { useMediaQuery } from "../_components/use-media-query";

const TABS: Tab[] = ["all", "absent", "late", "nodata"];

export default function TimesheetPage() {
  return (
    <ScreenGate screen="timesheet">
      <TimesheetScreen />
    </ScreenGate>
  );
}

function TimesheetScreen() {
  const t = useTranslations("kpiScreens.timesheet");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const me = useKpiMe();
  const { access } = useKpiPerms();
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => tashkentToday(now), [now]);
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? me.data?.current_period ?? calendarPeriod(now);
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return base.includes(period) ? base : [period, ...base];
  }, [now, period]);

  const [terminal, setTerminal] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ id: string; day: number | null } | null>(null);
  const phone = useMediaQuery("(max-width: 767px)");

  // Без placeholderData: при смене месяца строки прошлого месяца не остаются на экране.
  const board = useQuery<AttendanceBoard, Error>({
    queryKey: qk.attendanceBoard(period),
    queryFn: () => kpiApi.attendance.board(period),
    retry: shouldRetry,
  });
  const load = loadErrors(board);
  const data = board.data;

  const onOpen = useCallback((id: string, day: number | null) => setOpen({ id, day }), []);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="w-full text-xl font-semibold sm:mr-auto sm:w-auto">{t("title")}</h1>
        <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={options} className="h-9 w-[calc(50%-0.375rem)] sm:w-44" />
        {data && <BranchSelect data={data} value={terminal} onChange={setTerminal} />}
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-9 w-full sm:w-64"
        />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking, tk)}
        </p>
      ) : !data ? (
        <Loading label={tc("loading")} />
      ) : (
        <Board
          data={data}
          terminal={terminal}
          tab={tab}
          onTab={setTab}
          query={query}
          today={today}
          phone={phone}
          canSync={access.manage}
          month={monthLabel(period, locale)}
          open={open}
          onOpen={onOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function BranchSelect({ data, value, onChange }: { data: AttendanceBoard; value: string | null; onChange: (v: string | null) => void }) {
  const t = useTranslations("kpiScreens.timesheet");
  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data.employees) m.set(e.terminal_id, e.terminal_name ?? e.terminal_id);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [data]);
  // Один филиал в зоне (управляющий): выбирать нечего.
  if (branches.length < 2) return null;
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className="h-9 w-[calc(50%-0.375rem)] sm:w-52" aria-label={t("branchLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("branchAll")}</SelectItem>
        {branches.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Board({
  data,
  terminal,
  tab,
  onTab,
  query,
  today,
  phone,
  canSync,
  month,
  open,
  onOpen,
  onClose,
}: {
  data: AttendanceBoard;
  terminal: string | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  query: string;
  today: string;
  phone: boolean;
  canSync: boolean;
  month: string;
  open: { id: string; day: number | null } | null;
  onOpen: (id: string, day: number | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations("kpiScreens.timesheet");
  const { period, days_in_month: daysInMonth, employees } = data;

  // Филиал выбран, а в новом месяце его нет в списке: показываем всех.
  const activeTerminal = terminal && employees.some((e) => e.terminal_id === terminal) ? terminal : null;
  const inScope = useMemo(() => filterBoard(employees, { tab: "all", terminal: activeTerminal, query }), [employees, activeTerminal, query]);
  const counts = useMemo(() => tabCounts(inScope), [inScope]);
  const rows = useMemo(() => filterBoard(employees, { tab, terminal: activeTerminal, query }), [employees, tab, activeTerminal, query]);
  const groups = useMemo(() => groupByTerminal(rows), [rows]);
  const { branches, medians } = useMemo(() => branchStats(employees), [employees]);
  const stats = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);
  const totals = useMemo(() => sumTotals(employees.filter((e) => !activeTerminal || e.terminal_id === activeTerminal).map((e) => totalsOf(e.days))), [employees, activeTerminal]);
  const above = activeTerminal ? [] : branches.filter((b) => b.above);
  // Одна организация — одно число; несколько (сеть целиком) — по числу на организацию, как в блоке качества Workly.
  const medianText = medians.length === 1 ? formatShare(medians[0].median) : medians.map((m) => (m.name ? `${m.name} ${formatShare(m.median)}` : formatShare(m.median))).join(", ");
  const picked = open ? (employees.find((e) => e.id === open.id) ?? null) : null;

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm leading-6">
        {totals.recorded === 0 ? (
          <>
            {t("summary.empty", { month })}{" "}
            {canSync && (
              <Link href="/kpi/workly" className="underline underline-offset-4">
                {t("summary.sync")}
              </Link>
            )}
          </>
        ) : (
          <>
            {t("summary.main", {
              share: formatShare(absentShare(totals)),
              absent: totals.absent,
              recorded: totals.recorded,
              late: formatShare(lateShare(totals)),
            })}{" "}
            {!activeTerminal && branches.length > 1 && (
              <span className="text-muted-foreground">
                {above.length > 0
                  ? t("summary.above", { branches: above.map((b) => `${b.name} (${formatShare(b.share)})`).join(", "), median: medianText })
                  : t("summary.noAbove", { median: medianText })}
              </span>
            )}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b">
        <div role="tablist" aria-label={t("tabsLabel")} className="flex gap-5 overflow-x-auto">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => onTab(k)}
              className={cn(
                "whitespace-nowrap border-b-2 pb-2 text-sm outline-none focus-visible:underline",
                tab === k ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`tabs.${k}`)} <span className="tabular-nums text-muted-foreground">{counts[k]}</span>
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-xs text-muted-foreground">
          {(["ontime", "late", "absent"] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn("size-3 rounded-[3px]", CELL[s])} aria-hidden />
              {t(`legend.${s}`)}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="block h-px w-3 bg-muted-foreground/60" aria-hidden />
            {t("legend.none")}
          </li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("state.noRows")}</p>
      ) : phone ? (
        <EmployeeList period={period} today={today} groups={groups} showGroups={groups.length > 1} stats={stats} onOpen={onOpen} />
      ) : (
        <MonthMatrix
          period={period}
          daysInMonth={daysInMonth}
          today={today}
          groups={groups}
          showGroups={groups.length > 1}
          stats={stats}
          onOpen={onOpen}
        />
      )}

      <p className="max-w-3xl text-xs text-muted-foreground">{t("note")}</p>

      <EmployeeSheet
        employee={picked}
        focusDay={open?.day ?? null}
        period={period}
        daysInMonth={daysInMonth}
        today={today}
        onClose={onClose}
      />
    </div>
  );
}
