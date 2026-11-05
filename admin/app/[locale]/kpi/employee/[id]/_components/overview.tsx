"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EmployeeCard } from "@admin/lib/kpi-api";
import type { TgDisputeInfo, TgRaiseHint, TgRaiseCard, TgReviewStatus } from "@backend/modules/kpi/tg-app/types";
import { lostItems, pickTitle, reachedTier } from "@admin/lib/kpi/employee-card";
import { formatSum, formatTashkent } from "@admin/lib/kpi/format";
import { monthLabel, quarterLabel } from "@admin/lib/kpi/periods";
import type { Tone } from "@admin/lib/kpi/status";
import { totalsOf, formatShare } from "@admin/lib/kpi/timesheet";
import { attendanceDays, daysInPeriod } from "@admin/lib/kpi/employee-card";
import { cn } from "@admin/lib/utils";
import { KpiBadge } from "../../../_components/kpi-badge";

const STATUS_TONE: Record<TgReviewStatus, Tone> = { ready: "green", dispute_open: "red", dispute_resolved: "gray", changed: "blue" };

/** Верх карточки: оценка месяца, прибавка квартала и три числа по посещаемости и нарушениям. */
export function Overview({ card }: { card: EmployeeCard }) {
  return (
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <MonthBlock card={card} />
      <RaiseBlock raise={card.home.raise} hasCard={card.employee.has_card} />
      <Figures card={card} />
    </div>
  );
}

function MonthBlock({ card }: { card: EmployeeCard }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const locale = useLocale();
  const month = monthLabel(card.period, locale);
  const r = card.review;
  const lost = r ? lostItems(r.items) : [];
  return (
    <section aria-label={t("month.title", { month })} className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("month.title", { month })}</h2>
      {!card.employee.has_card ? (
        <p className="text-sm text-muted-foreground">{t("month.noCard")}</p>
      ) : !r ? (
        <p className="text-xl text-muted-foreground">{t("month.none", { month })}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-4xl font-normal tabular-nums">{formatShare(r.score_pct)}</span>
            <KpiBadge tone={STATUS_TONE[r.status]}>{t(`month.status.${r.status}` as never)}</KpiBadge>
          </div>
          <DisputeLine d={r.dispute} />
          <div>
            <h3 className="mb-1 text-sm font-medium">{t("month.lost")}</h3>
            {lost.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("month.lostNone")}</p>
            ) : (
              <ul className="divide-y text-sm">
                {lost.map((x) => (
                  <li key={x.item_id} className="flex items-baseline justify-between gap-4 py-1.5">
                    <span>{pickTitle(locale, x.title_ru, x.title_uz)}</span>
                    <span className="tabular-nums text-red-600 dark:text-red-400">{formatShare(x.score)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function DisputeLine({ d }: { d: TgDisputeInfo }) {
  // Ключи собираются из состояния спора, поэтому типизированный переводчик заменён на свободный.
  const t = useTranslations("kpiScreens.employeeCard") as unknown as (key: string, values?: Record<string, string>) => string;
  const lines: string[] = [];
  if (d.state !== "cancelled") {
    lines.push(t(`month.dispute.${d.state}`, { date: formatTashkent(d.state === "open" ? d.opened_at : d.deadline, false) }));
  }
  if (d.last_resolved) {
    lines.push(t(`month.resolved.${d.last_resolved.decision}`, { date: formatTashkent(d.last_resolved.resolved_at, false) }));
  }
  if (lines.length === 0) return null;
  return (
    <div className="space-y-0.5 text-sm text-muted-foreground">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {d.last_resolved?.comment && <p className="italic">«{d.last_resolved.comment}»</p>}
    </div>
  );
}

function hintText(h: TgRaiseHint, tr: ReturnType<typeof useTranslations>, tk: ReturnType<typeof useTranslations>): string {
  const money = (n: number) => formatSum(n, tk as never);
  const nextLine = (next: Extract<TgRaiseHint, { kind: "running" | "too_few" }>["next"]) =>
    next === null ? "" : next.reachable ? tr("raise.hint.next", { amount: money(next.amount), need: formatShare(next.need_pct), n: next.periods.length }) : tr("raise.hint.nextNo");
  switch (h.kind) {
    case "decided":
      return h.amount === 0 ? tr("raise.hint.decided0") : tr("raise.hint.decided", { amount: money(h.amount) });
    case "waiting_hr":
      return tr("raise.hint.waiting_hr", { amount: money(h.amount) });
    case "none":
      return tr("raise.hint.none");
    case "impossible":
      return tr("raise.hint.impossible", { scored: h.scored, min: h.min_months });
    case "too_few":
      return [tr("raise.hint.too_few", { scored: h.scored, min: h.min_months, amount: money(h.amount) }), nextLine(h.next)].filter(Boolean).join(". ");
    case "running":
      return [tr("raise.hint.running", { amount: money(h.amount) }), nextLine(h.next)].filter(Boolean).join(". ");
  }
}

function RaiseBlock({ raise, hasCard }: { raise: TgRaiseCard | null; hasCard: boolean }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  if (!hasCard || !raise) return null;
  const reached = reachedTier(raise.avg_pct, raise.tiers);
  return (
    <section aria-label={t("raise.title", { quarter: quarterLabel(raise.quarter_start, tk as never) })} className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("raise.title", { quarter: quarterLabel(raise.quarter_start, tk as never) })}</h2>
      <div className="flex flex-wrap items-baseline gap-x-3">
        {raise.avg_pct === null ? (
          <span className="text-xl text-muted-foreground">{t("raise.noAvg")}</span>
        ) : (
          <>
            <span className="text-4xl font-normal tabular-nums">{formatShare(raise.avg_pct)}</span>
            <span className="text-sm text-muted-foreground">{t("raise.avg")}</span>
          </>
        )}
      </div>
      <ul className="flex flex-wrap gap-2 text-sm">
        {raise.tiers.map((tier) => (
          <li
            key={tier.min_pct}
            className={cn("rounded-md px-3 py-1.5 tabular-nums", reached?.min_pct === tier.min_pct ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-muted text-foreground/80")}
          >
            {t("raise.tier", { pct: formatShare(tier.min_pct), amount: formatSum(tier.amount, tk as never) })}
            {reached?.min_pct === tier.min_pct && <span className="ml-2 text-xs">{t("raise.reached")}</span>}
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-1 text-xs text-muted-foreground">{t("raise.months")}</h3>
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
          {raise.months.map((m) => (
            <li key={m.period}>
              <span className="text-muted-foreground">{monthLabel(m.period, locale)}: </span>
              {m.score_pct !== null ? formatShare(m.score_pct) : m.state === "not_rated" ? t("raise.notRated") : "—"}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm">{hintText(raise.hint, t, tk)}</p>
    </section>
  );
}

function Figures({ card }: { card: EmployeeCard }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const totals = totalsOf(attendanceDays(daysInPeriod(card.period), card.attendance));
  const active = card.violations.items.filter((v) => v.status === "active").length;
  const items = [
    { k: "absent", v: totals.recorded === 0 ? "—" : String(totals.absent), tone: totals.absent > 0 ? "text-red-600 dark:text-red-400" : "" },
    { k: "late", v: totals.recorded === 0 ? "—" : String(totals.late), tone: totals.late > 0 ? "text-amber-700 dark:text-amber-400" : "" },
    { k: "violations", v: String(active), tone: "" },
  ] as const;
  return (
    <dl className="flex gap-10 lg:col-span-2">
      {items.map((x) => (
        <div key={x.k}>
          <dd className={cn("text-3xl font-normal tabular-nums", x.tone)}>{x.v}</dd>
          <dt className="text-xs text-muted-foreground">{t(`overview.${x.k}` as never)}</dt>
        </div>
      ))}
    </dl>
  );
}
