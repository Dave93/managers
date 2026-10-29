import React from "react";
import { useTranslations } from "next-intl";

/** Версия балла посчитана до конца месяца: продажи к месячному плану занижены, предложений в оценку нет. */
export function PreliminaryNote() {
  const t = useTranslations("kpi");
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {t("lib.branch.preliminary")}
    </p>
  );
}
