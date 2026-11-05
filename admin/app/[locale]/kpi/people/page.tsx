"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Skeleton } from "@admin/components/ui/skeleton";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type PeopleRow } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL } from "@admin/lib/kpi/filters";
import { calendarPeriod, monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import {
  PEOPLE_TABS,
  filterPeople,
  nameOf,
  peopleTabCounts,
  scoreOf,
  sortPeople,
  summarizePeople,
  type PeopleSort,
  type PeopleTab,
} from "@admin/lib/kpi/people";
import { formatShare } from "@admin/lib/kpi/timesheet";
import { rowStatus, ROW_STATUS } from "@admin/lib/kpi/status";
import { cn } from "@admin/lib/utils";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { useMediaQuery } from "../_components/use-media-query";
import { qk, useKpiMe } from "../_components/use-kpi";

export default function PeoplePage() {
  return (
    <ScreenGate screen="people">
      <PeopleScreen />
    </ScreenGate>
  );
}

function PeopleScreen() {
  const t = useTranslations("kpiScreens.people");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const me = useKpiMe();
  const now = useMemo(() => new Date(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? me.data?.current_period ?? calendarPeriod(now);
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return base.includes(period) ? base : [period, ...base];
  }, [now, period]);
  const [terminal, setTerminal] = useState<string | null>(null);
  const [tab, setTab] = useState<PeopleTab>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PeopleSort>("default");
  const phone = useMediaQuery("(max-width: 767px)");

  const people = useQuery<PeopleRow[], Error>({
    queryKey: qk.people(period),
    queryFn: () => kpiApi.people(period),
    retry: shouldRetry,
  });
  const load = loadErrors(people);
  const rows = people.data;

  const branches = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(r.terminal_id, r.terminal_name ?? r.terminal_id);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [rows]);
  const activeTerminal = terminal && branches.some(([id]) => id === terminal) ? terminal : null;
  const inScope = useMemo(() => filterPeople(rows ?? [], { tab: "all", terminal: activeTerminal, query }), [rows, activeTerminal, query]);
  const counts = useMemo(() => peopleTabCounts(inScope), [inScope]);
  const shown = useMemo(() => sortPeople(filterPeople(rows ?? [], { tab, terminal: activeTerminal, query }), sort), [rows, tab, activeTerminal, query, sort]);
  const sum = useMemo(() => summarizePeople(filterPeople(rows ?? [], { tab: "all", terminal: activeTerminal, query: "" })), [rows, activeTerminal]);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="w-full text-xl font-semibold sm:mr-auto sm:w-auto">{t("title")}</h1>
        <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={options} className="h-9 w-[calc(50%-0.375rem)] sm:w-44" />
        {branches.length > 1 && (
          <Select value={activeTerminal ?? ALL} onValueChange={(v) => setTerminal(v === ALL ? null : v)}>
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
        )}
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-9 w-full sm:w-64" />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking, tk)}
        </p>
      ) : !rows ? (
        <div role="status" aria-label={tc("loading")} className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <p className="max-w-3xl text-sm leading-6">
            {t("summary", { scored: sum.scored, total: sum.total, disputed: sum.disputed, violations: sum.violations, absent: sum.absent })}{" "}
            <span className="text-muted-foreground">{monthLabel(period, locale)}</span>
          </p>

          <div role="tablist" aria-label={t("tabsLabel")} className="flex gap-5 overflow-x-auto border-b">
            {PEOPLE_TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "whitespace-nowrap border-b-2 pb-2 text-sm outline-none focus-visible:underline",
                  tab === k ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t(`tabs.${k}`)} <span className="tabular-nums text-muted-foreground">{counts[k]}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("state.noRows")}</p>
          ) : phone ? (
            <PeopleList rows={shown} period={period} />
          ) : (
            <PeopleTable rows={shown} period={period} sort={sort} onSort={setSort} />
          )}
        </>
      )}
    </div>
  );
}

const SORT_COLS = ["score", "absent", "late", "violations"] as const;

function PeopleTable({ rows, period, sort, onSort }: { rows: PeopleRow[]; period: string; sort: PeopleSort; onSort: (s: PeopleSort) => void }) {
  const t = useTranslations("kpiScreens.people");
  const head = (key: (typeof SORT_COLS)[number], align: "left" | "right") => (
    <th scope="col" aria-sort={sort === key ? (key === "score" ? "ascending" : "descending") : "none"} className={cn("py-2 pr-4 text-xs font-normal", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => onSort(sort === key ? "default" : key)}
        aria-label={t("sortBy", { col: t(`cols.${key}`) })}
        className={cn("outline-none hover:text-foreground focus-visible:underline", sort === key ? "font-medium text-foreground" : "text-muted-foreground")}
      >
        {t(`cols.${key}`)}
        {sort === key && <span aria-hidden> {key === "score" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 pr-4 text-left text-xs font-normal text-muted-foreground">{t("cols.employee")}</th>
            <th scope="col" className="py-2 pr-4 text-left text-xs font-normal text-muted-foreground">{t("cols.branch")}</th>
            {head("score", "left")}
            {head("absent", "right")}
            {head("late", "right")}
            {head("violations", "right")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <PersonRow key={r.id} r={r} period={period} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PersonRow = React.memo(function PersonRow({ r, period }: { r: PeopleRow; period: string }) {
  const t = useTranslations("kpiScreens.people");
  const tk = useTranslations("kpi");
  const { absent, late } = r.attendance;
  const recorded = r.attendance.ontime + late + absent;
  return (
    <tr className="group border-b last:border-b-0 hover:bg-muted/50">
      <td className="py-2 pr-4">
        <Link href={`/kpi/employee/${r.id}?period=${period}`} className={cn("block outline-none focus-visible:underline", !r.active && "opacity-60")}>
          <span className="block">{nameOf(r)}</span>
          {r.staff_role_name && <span className="block text-xs text-muted-foreground">{r.staff_role_name}</span>}
        </Link>
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{r.terminal_name ?? "—"}</td>
      <td className="py-2 pr-4">
        <ScoreCell r={r} t={t} tk={tk} />
      </td>
      <td className={cn("py-2 pr-4 text-right tabular-nums", absent ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>{recorded === 0 ? "—" : absent}</td>
      <td className={cn("py-2 pr-4 text-right tabular-nums", late ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{recorded === 0 ? "—" : late}</td>
      <td className={cn("py-2 pr-4 text-right tabular-nums", r.violations ? "font-medium" : "text-muted-foreground")}>{r.violations}</td>
    </tr>
  );
});

function ScoreCell({ r, t, tk }: { r: PeopleRow; t: ReturnType<typeof useTranslations>; tk: ReturnType<typeof useTranslations> }) {
  const score = scoreOf(r);
  const st = ROW_STATUS[rowStatus(r)];
  if (r.card === null) return <span className="text-muted-foreground">{t("state.noCard")}</span>;
  return (
    <span className="flex items-center gap-2">
      {score !== null && <span className="tabular-nums">{formatShare(score)}</span>}
      {(score === null || r.open_dispute) && <KpiBadge tone={st.tone}>{tk(st.labelKey)}</KpiBadge>}
    </span>
  );
}

function PeopleList({ rows, period }: { rows: PeopleRow[]; period: string }) {
  const t = useTranslations("kpiScreens.people");
  const tk = useTranslations("kpi");
  return (
    <ul>
      {rows.map((r) => {
        const { absent, late } = r.attendance;
        const none = r.attendance.ontime + late + absent === 0;
        return (
          <li key={r.id} className="border-b last:border-b-0">
            <Link href={`/kpi/employee/${r.id}?period=${period}`} className="block py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn("truncate text-sm", !r.active && "opacity-60")}>{nameOf(r)}</span>
                <ScoreCell r={r} t={t} tk={tk} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">{[r.staff_role_name, r.terminal_name].filter(Boolean).join(" · ")}</span>
              <span className="mt-1 flex gap-4 text-xs tabular-nums text-muted-foreground">
                <span className={absent ? "font-medium text-red-600 dark:text-red-400" : ""}>{t("cols.absent")} {none ? "—" : absent}</span>
                <span className={late ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{t("cols.late")} {none ? "—" : late}</span>
                <span className={r.violations ? "font-medium text-foreground" : ""}>{t("cols.violations")} {r.violations}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
