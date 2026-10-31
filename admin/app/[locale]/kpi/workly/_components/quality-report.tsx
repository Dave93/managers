"use client";
// Качество данных посещаемости организации за месяц (раздел 5.7 спеки): доля прогулов по
// филиалам с пометкой «выше нормы» (больше удвоенной медианы по организации) и сотрудники,
// отсутствующие более чем в 90% дней (от 5 дней). Порядок филиалов и сотрудников — как отдаёт
// сервер. Отчёт читается из записанной посещаемости, Workly не вызывается.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type WorklyQuality } from "@admin/lib/kpi-api";
import { loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { monthLabel } from "@admin/lib/kpi/periods";
import { formatShare, shortId } from "@admin/lib/kpi/workly-view";
import { KpiBadge } from "../../_components/kpi-badge";
import { StaleNote } from "../../_components/stale-note";
import { qk } from "../../_components/use-kpi";
import { useWorklyText } from "./workly-text";

export function QualityReport({ organizationId, period }: { organizationId: string; period: string }) {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const text = useWorklyText();
  const locale = useLocale();
  const report = useQuery<WorklyQuality, Error>({
    queryKey: qk.worklyQuality(organizationId, period),
    queryFn: () => kpiApi.workly.quality(organizationId, period),
    enabled: Boolean(organizationId && period),
    retry: shouldRetry,
  });
  const { blocking, stale } = loadErrors(report);
  const data = report.data;

  return (
    <section aria-labelledby="workly-quality" className="space-y-3 border-t pt-4">
      <div className="space-y-1">
        <h3 id="workly-quality" className="text-sm font-semibold">
          {t("quality.heading", { month: monthLabel(period, locale) })}
        </h3>
        <p className="text-sm text-muted-foreground">{t("quality.intro")}</p>
      </div>

      {blocking ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {text.apiError(blocking)}
        </p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : data.branches.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm">{t("quality.empty")}</p>
      ) : (
        <div className="space-y-3">
          {stale != null && <StaleNote error={stale} />}
          <p className="text-sm">{t("quality.median", { value: formatShare(data.median, locale) })}</p>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label={t("quality.tableAria")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("quality.colBranch")}</TableHead>
                  <TableHead className="text-right">{t("quality.colDays")}</TableHead>
                  <TableHead className="text-right">{t("quality.colAbsent")}</TableHead>
                  <TableHead className="text-right">{t("quality.colShare")}</TableHead>
                  <TableHead>{t("quality.colMark")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.branches.map((b) => (
                  <TableRow key={b.terminal_id}>
                    <TableCell className="min-w-[10rem] break-words">{b.terminal_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.days}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.absent}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{formatShare(b.share, locale)}</TableCell>
                    <TableCell>{b.flagged ? <KpiBadge tone="amber">{t("quality.flagged")}</KpiBadge> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-1">
            <h4 className="text-sm font-medium">{t("quality.heavyHeading")}</h4>
            {data.heavy.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("quality.heavyEmpty")}</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-sm">
                {data.heavy.map((h) => (
                  <li key={h.employee_id} className="break-words">
                    {t("quality.heavyRow", {
                      name: data.employee_names[h.employee_id] || shortId(h.employee_id),
                      absent: h.absent,
                      days: h.days,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
