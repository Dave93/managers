"use client";
import React from "react";
import { useLocale, useTranslations } from "next-intl";
import type { EmployeeCard } from "@admin/lib/kpi-api";
import { formatSum } from "@admin/lib/kpi/format";
import { monthLabel, quarterLabel } from "@admin/lib/kpi/periods";
import { formatShare } from "@admin/lib/kpi/timesheet";

export function HistoryTab({ card }: { card: EmployeeCard }) {
  const t = useTranslations("kpiScreens.employeeCard");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  const quarters = card.history.quarters;
  if (quarters.length === 0) return <p className="py-6 text-sm text-muted-foreground">{t("history.none")}</p>;
  return (
    <ul className="divide-y">
      {quarters.map((q) => (
        <li key={q.quarter_start} className="space-y-1.5 py-4 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-4">
            <span className="font-medium">{quarterLabel(q.quarter_start, tk as never)}</span>
            {q.avg_pct !== null && <span className="tabular-nums text-muted-foreground">{t("history.avg", { pct: formatShare(q.avg_pct) })}</span>}
            <span>
              {q.result.kind === "decided"
                ? q.result.amount === 0
                  ? t("history.decided0")
                  : t("history.decided", { amount: formatSum(q.result.amount, tk as never) })
                : t(`history.${q.result.kind}` as never)}
            </span>
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
            {q.months.map((m) => (
              <li key={m.period}>
                <span className="text-muted-foreground">{monthLabel(m.period, locale)}: </span>
                {m.score_pct !== null ? formatShare(m.score_pct) : "—"}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
