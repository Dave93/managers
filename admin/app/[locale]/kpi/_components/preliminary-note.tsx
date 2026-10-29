import React from "react";
import { PRELIMINARY_TEXT } from "@admin/lib/kpi/branch";

/** Версия балла посчитана до конца месяца: продажи к месячному плану занижены, предложений в оценку нет. */
export function PreliminaryNote() {
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {PRELIMINARY_TEXT}
    </p>
  );
}
