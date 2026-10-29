"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { kpiErrorText } from "@admin/lib/kpi/errors";

/** Фоновое обновление не удалось, а данные уже на экране: предупреждаем, но форму и список не убираем. */
export function StaleNote({ error }: { error: unknown }) {
  const t = useTranslations("kpi");
  return (
    <div role="alert" className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>{t("common.staleNote")}</p>
      <p className="text-xs">{kpiErrorText(error, t)}</p>
    </div>
  );
}
