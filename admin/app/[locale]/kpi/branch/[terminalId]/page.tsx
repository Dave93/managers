"use client";
import React, { Suspense, useMemo } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@admin/i18n/routing";
import { kpiApi, type BranchBreakdown } from "@admin/lib/kpi-api";
import { canOpen } from "@admin/lib/kpi/access";
import { formatScore, nextTierText, tierTone } from "@admin/lib/kpi/branch";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatPct, formatTashkent } from "@admin/lib/kpi/format";
import { calendarPeriod, monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import { failedTitles } from "@admin/lib/kpi/sanitary";
import { KpiBadge } from "../../_components/kpi-badge";
import { PeriodSelect } from "../../_components/period-select";
import { ScreenGate } from "../../_components/screen-gate";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe, useKpiPerms } from "../../_components/use-kpi";
import { IndicatorCard } from "./_components/indicator-card";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

export default function BranchPage() {
  return (
    <ScreenGate screen="branch">
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Загрузка…</p>}>
        <BranchScreen />
      </Suspense>
    </ScreenGate>
  );
}

function BranchScreen() {
  const { terminalId } = useParams<{ terminalId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const { perms } = useKpiPerms();
  const me = useKpiMe();

  const asked = params.get("period");
  const period = asked && PERIOD_RE.test(asked) ? asked : (me.data?.current_period ?? calendarPeriod(now));
  const options = useMemo(() => {
    const base = periodOptions(now, 12);
    return base.includes(period) ? base : [period, ...base];
  }, [now, period]);

  const change = (p: string | null) => {
    if (!p) return;
    const next = new URLSearchParams(params.toString());
    next.set("period", p);
    router.replace(`${pathname}?${next.toString()}`);
  };

  // Без placeholderData: при смене месяца карточки прошлого месяца не остаются на экране.
  const detail = useQuery<BranchBreakdown, Error>({
    queryKey: qk.branchDetail(terminalId, period),
    queryFn: () => kpiApi.branch.detail(terminalId, period),
    retry: shouldRetry,
  });
  const load = loadErrors(detail);
  const data = detail.data;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <Link href="/kpi/network" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:underline">
        ← Сеть
      </Link>

      {load.blocking == null && load.stale != null && <StaleNote error={load.stale} />}

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking)}
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="mr-2 text-xl font-semibold">
              {data.terminal_name ?? "Филиал"} · {monthLabel(period)}
            </h1>
            <PeriodSelect value={period} onChange={change} options={options} className="w-44" />
          </div>

          <div className="space-y-1">
            {data.version === null || data.score === null ? (
              <p className="text-sm text-muted-foreground">Балл за этот месяц не посчитан</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-4xl font-semibold">{formatScore(data.score)}</span>
                  {data.tier_pct !== null && (
                    <KpiBadge tone={tierTone(data.tier_pct)}>{data.tier_pct}&nbsp;%</KpiBadge>
                  )}
                </div>
                <p className="text-sm">{nextTierText(data.next_tier)}</p>
                <p className="text-sm text-muted-foreground">Посчитано {formatTashkent(data.computed_at)}</p>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {data.indicators.map((r) => (
              <IndicatorCard key={r.code} r={r} />
            ))}
          </div>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-2 text-base font-medium">Санитарные проверки</h2>
              {canOpen(perms, "sanitary") && (
                <Link
                  href={`/kpi/sanitary/new?terminal_id=${terminalId}`}
                  className="inline-flex h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted/50"
                >
                  Новая проверка
                </Link>
              )}
            </div>
            {data.sanitary_checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Проверок за месяц нет</p>
            ) : (
              <ul className="space-y-2">
                {data.sanitary_checks.map((c) => {
                  const failed = failedTitles(c);
                  return (
                    <li key={c.id} className="space-y-1 rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {formatTashkent(c.checked_at)} · {c.inspector_name ?? "—"}
                        </span>
                        <span className="font-medium">{formatPct(c.pct)}</span>
                      </div>
                      {failed.length > 0 && <p className="text-muted-foreground">Не выполнено: {failed.join(", ")}</p>}
                      {c.comment && <p>{c.comment}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
