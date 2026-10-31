"use client";
// Тексты ошибок экрана Workly. Коды маршрутов и прогонов — из kpiScreens.workly.errors.*,
// причины остановки ночного прогона — из kpiScreens.workly.blocked.*. Сеть, права и 5xx
// (кодов нет в списке Workly) получают общий текст KPI.

import { useTranslations } from "next-intl";
import { kpiErrorText } from "@admin/lib/kpi/errors";
import { blockReasonKey, connectionErrorKey } from "@admin/lib/kpi/workly";
import { inWorkly, worklyErrorKey } from "@admin/lib/kpi/workly-view";

export function useWorklyText() {
  const t = useTranslations("kpiScreens.workly");
  const tk = useTranslations("kpi");
  return {
    /** Ошибка ответа маршрута /workly/* (KpiApiError) или сети. */
    apiError: (e: unknown): string => {
      const key = worklyErrorKey(e);
      return key ? t(key) : kpiErrorText(e, tk);
    },
    /** Код, с которым завершился прогон (run.error), или код ошибки подключения из статуса. */
    runError: (code: string | null | undefined): string => t(inWorkly(connectionErrorKey(code) ?? "workly.errors.unknown")),
    /** Причина остановки ночного прогона (run.block_reason). */
    blocked: (reason: string | null | undefined): string => t(inWorkly(blockReasonKey(reason) ?? "workly.blocked.unknown")),
  };
}
