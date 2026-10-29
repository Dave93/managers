import React from "react";
import { useTranslations } from "next-intl";
import type { BranchIndicatorResult } from "@admin/lib/kpi-api";
import { cn } from "@admin/lib/utils";
import { NO_DATA_REASON_KEY, cellTone, detailsText, formatFact, indicatorLine, noDataDetailsText } from "@admin/lib/kpi/branch";
import type { Tone } from "@admin/lib/kpi/status";

const BORDER: Record<Tone, string> = {
  green: "border-green-300 bg-green-50/40",
  amber: "border-amber-300 bg-amber-50/40",
  red: "border-red-300 bg-red-50/40",
  blue: "border-blue-300 bg-blue-50/40",
  gray: "border-gray-200",
};

const num = (n: number) => String(n).replace(".", ",");

/**
 * Карточка показателя балла филиала: факт, пороги, баллы и вклад или причина «нет данных».
 * all — все показатели версии филиала: при неполном покрытии весом карточка показывает фактический вес.
 */
export function IndicatorCard({ r, all }: { r: BranchIndicatorResult; all: readonly BranchIndicatorResult[] }) {
  const t = useTranslations("kpiScreens.branch.indicator");
  const tk = useTranslations("kpi");
  const tone = cellTone({ points: r.points, data_status: r.data_status });
  const details = r.data_status === "ok" ? detailsText(r.code, r.details, tk) : "";
  const noDataDetails = r.data_status === "ok" ? "" : noDataDetailsText(r.code, r.reason, r.details, tk);
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-3", BORDER[tone])}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{r.title_ru}</h3>
        <span className="text-lg font-semibold whitespace-nowrap">{formatFact(r.fact, tk)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("thresholds", {
          floor: num(r.floor),
          target: num(r.target),
          max: num(r.max),
          direction: r.direction === "higher_better" ? t("higherBetter") : t("lowerBetter"),
        })}
      </p>
      {r.data_status === "ok" ? (
        <>
          <p className="text-sm">{indicatorLine(r, all, tk)}</p>
          {details !== "" && <p className="text-xs text-muted-foreground">{details}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("noData", { reason: (r.reason && Object.hasOwn(NO_DATA_REASON_KEY, r.reason) && tk(NO_DATA_REASON_KEY[r.reason])) || t("noReason") })}
          {noDataDetails !== "" && ` · ${noDataDetails}`}
        </p>
      )}
    </div>
  );
}
