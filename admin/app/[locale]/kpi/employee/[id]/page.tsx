"use client";
import React, { useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@admin/components/ui/skeleton";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type EmployeeCard } from "@admin/lib/kpi-api";
import { attendanceDays, daysInPeriod } from "@admin/lib/kpi/employee-card";
import { KpiApiError, kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { calendarPeriod, periodOptions } from "@admin/lib/kpi/periods";
import { tashkentToday } from "@admin/lib/kpi/timesheet";
import { cn } from "@admin/lib/utils";
import { AttendanceMonth } from "../../_components/attendance-month";
import { KpiBadge } from "../../_components/kpi-badge";
import { PeriodSelect } from "../../_components/period-select";
import { ScreenGate } from "../../_components/screen-gate";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe } from "../../_components/use-kpi";
import { EmployeeSwitch } from "./_components/employee-switch";
import { HistoryTab } from "./_components/history-tab";
import { Overview } from "./_components/overview";
import { ReviewTab } from "./_components/review-tab";
import { ViolationsTab } from "./_components/violations-tab";

const TABS = ["review", "attendance", "violations", "history"] as const;
type Tab = (typeof TABS)[number];
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export default function EmployeeCardPage() {
  return (
    <ScreenGate screen="people">
      <CardScreen />
    </ScreenGate>
  );
}

function CardScreen() {
  const t = useTranslations("kpiScreens.employeeCard");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const { id } = useParams<{ id: string }>();
  const asked = useSearchParams().get("period");
  const me = useKpiMe();
  const now = useMemo(() => new Date(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? (asked && PERIOD_RE.test(asked) ? asked : (me.data?.current_period ?? calendarPeriod(now)));
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return base.includes(period) ? base : [period, ...base];
  }, [now, period]);
  const [tab, setTab] = useState<Tab>("review");

  const card = useQuery<EmployeeCard, Error>({
    queryKey: qk.employeeCard(id, period),
    queryFn: () => kpiApi.employees.profile(id, period),
    retry: shouldRetry,
  });
  const load = loadErrors(card);
  const notFound = load.blocking instanceof KpiApiError && (load.blocking.status === 404 || load.blocking.status === 403);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/kpi/people" className="mr-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <span aria-hidden>←</span>
          {t("back")}
        </Link>
        <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={options} className="h-9 w-[calc(50%-0.375rem)] sm:w-44" />
        <EmployeeSwitch period={period} currentId={id} />
      </div>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {notFound ? t("notFound") : kpiErrorText(load.blocking, tk)}
        </p>
      ) : !card.data ? (
        <div role="status" aria-label={tc("loading")} className="space-y-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <CardBody card={card.data} tab={tab} onTab={setTab} today={tashkentToday(now)} />
      )}
    </div>
  );
}

function CardBody({ card, tab, onTab, today }: { card: EmployeeCard; tab: Tab; onTab: (t: Tab) => void; today: string }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const e = card.employee;
  const daysInMonth = daysInPeriod(card.period);
  const days = useMemo(() => attendanceDays(daysInMonth, card.attendance), [daysInMonth, card.attendance]);
  // Как в списке и в обзоре: считаем только действующие нарушения, отменённые остаются в списке вкладки.
  const activeViolations = card.violations.items.filter((v) => v.status === "active").length;
  return (
    <>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{`${e.last_name} ${e.first_name}`.trim()}</h1>
        <p className="text-sm text-muted-foreground">
          {[e.position, e.terminal_name, e.organization_name, e.tab_number ? t("tab", { n: e.tab_number }) : null].filter(Boolean).join(" · ")}
        </p>
        <div className="flex flex-wrap gap-2">
          {!e.active && <KpiBadge tone="gray">{t("inactive")}</KpiBadge>}
          <KpiBadge tone={e.workly_linked ? "green" : "gray"}>{t(e.workly_linked ? "workly.on" : "workly.off")}</KpiBadge>
          <KpiBadge tone={e.telegram_bound ? "green" : "gray"}>{t(e.telegram_bound ? "telegram.on" : "telegram.off")}</KpiBadge>
        </div>
      </header>

      <Overview card={card} />

      <div>
        <div role="tablist" aria-label={t("tabsLabel")} className="flex gap-5 overflow-x-auto border-b">
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
              {t(`tabs.${k}`)}
              {k === "violations" && activeViolations > 0 && <span className="ml-1.5 tabular-nums text-muted-foreground">{activeViolations}</span>}
            </button>
          ))}
        </div>
        <div className="pt-4">
          {tab === "review" && <ReviewTab card={card} />}
          {tab === "attendance" && (
            <div className="max-w-md">
              <AttendanceMonth days={days} period={card.period} daysInMonth={daysInMonth} today={today} />
            </div>
          )}
          {tab === "violations" && <ViolationsTab card={card} />}
          {tab === "history" && <HistoryTab card={card} />}
        </div>
      </div>
    </>
  );
}
