"use client";
import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { calendarPeriod, periodOptions } from "@admin/lib/kpi/periods";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { useKpiMe } from "../_components/use-kpi";
import { ImportWizard } from "./_components/import-wizard";
import { ImportsTable } from "./_components/imports-table";

export default function AttendancePage() {
  return (
    <ScreenGate screen="attendance">
      <AttendanceScreen />
    </ScreenGate>
  );
}

function AttendanceScreen() {
  const t = useTranslations("kpiScreens.attendance");
  const now = useMemo(() => new Date(), []);
  const me = useKpiMe();
  const options = useMemo(() => periodOptions(now, 12), [now]);
  // Пока пользователь не выбрал месяц сам, берём текущий период сервера, а до его ответа календарный.
  const [picked, setPicked] = useState<string | null>(null);
  const period = picked ?? me.data?.current_period ?? calendarPeriod(now);
  // Текущий период сервера мог выпасть из списка вариантов: добавляем его, иначе Select окажется пустым.
  const periods = options.includes(period) ? options : [period, ...options];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <PeriodSelect value={period} onChange={(v) => v && setPicked(v)} options={periods} className="h-11 w-full sm:w-60" />

      <ImportWizard period={period} />

      <section className="space-y-2">
        <h2 className="text-base font-medium">{t("importsHeading")}</h2>
        <ImportsTable period={period} />
      </section>
    </div>
  );
}
