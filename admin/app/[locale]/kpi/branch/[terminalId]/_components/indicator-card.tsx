import React from "react";
import type { BranchIndicatorResult } from "@admin/lib/kpi-api";
import { cn } from "@admin/lib/utils";
import { NO_DATA_REASON_TEXT, cellTone, detailsText, formatFact, formatPoints, formatScore } from "@admin/lib/kpi/branch";
import type { Tone } from "@admin/lib/kpi/status";

const BORDER: Record<Tone, string> = {
  green: "border-green-300 bg-green-50/40",
  amber: "border-amber-300 bg-amber-50/40",
  red: "border-red-300 bg-red-50/40",
  blue: "border-blue-300 bg-blue-50/40",
  gray: "border-gray-200",
};

const num = (n: number) => String(n).replace(".", ",");

/** Карточка показателя балла филиала: факт, пороги, баллы и вклад или причина «нет данных». */
export function IndicatorCard({ r }: { r: BranchIndicatorResult }) {
  const tone = cellTone({ points: r.points, data_status: r.data_status });
  const details = r.data_status === "ok" ? detailsText(r.code, r.details) : "";
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-3", BORDER[tone])}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{r.title_ru}</h3>
        <span className="text-lg font-semibold whitespace-nowrap">{formatFact(r.fact)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Порог {num(r.floor)} · цель {num(r.target)} · максимум {num(r.max)} ·{" "}
        {r.direction === "higher_better" ? "больше — лучше" : "меньше — лучше"}
      </p>
      {r.data_status === "ok" ? (
        <>
          <p className="text-sm">
            {formatPoints(r.points)} балла · вес {r.weight}&nbsp;% → {formatScore(r.weighted)}
          </p>
          {details !== "" && <p className="text-xs text-muted-foreground">{details}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Нет данных: {(r.reason && NO_DATA_REASON_TEXT[r.reason]) || "причина не указана"}
        </p>
      )}
    </div>
  );
}
