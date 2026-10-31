"use client";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { kpiApi, type WorklyStatusEntry } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk } from "../_components/use-kpi";
import { AttendanceSection } from "./_components/attendance-sync";
import { ConnectionCard } from "./_components/connection-card";
import { LocationsSection } from "./_components/locations-table";

export default function WorklyPage() {
  return (
    <ScreenGate screen="workly">
      <WorklyScreen />
    </ScreenGate>
  );
}

// Экран — плоский список секций: «Подключения» (у каждой организации своя проверка
// и сверка сотрудников), «Локации» (карта локаций Workly → терминал) и «Посещаемость»
// (синхронизация за месяц и качество данных). В двух последних организация выбирается
// переключателем раздела.
function WorklyScreen() {
  const t = useTranslations("kpiScreens.workly");
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <ConnectionsSection />
      <LocationsSection />
      <AttendanceSection />
    </div>
  );
}

function ConnectionsSection() {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const status = useQuery<WorklyStatusEntry[], Error>({
    queryKey: qk.worklyStatus,
    queryFn: () => kpiApi.workly.status(),
    retry: shouldRetry,
  });
  const { blocking, stale } = loadErrors(status);
  const entries = status.data ?? [];

  return (
    <section aria-labelledby="workly-connections" className="space-y-3">
      <h2 id="workly-connections" className="text-base font-medium">
        {t("connections.heading")}
      </h2>
      {blocking ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(blocking, tk)}
        </p>
      ) : status.isPending ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <div className="space-y-4">
          {stale != null && <StaleNote error={stale} />}
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("connections.empty")}</p>
          ) : (
            // key — ключ подключения: organization_id бывает null, если организация не найдена.
            entries.map((e) => <ConnectionCard key={e.key} entry={e} />)
          )}
        </div>
      )}
    </section>
  );
}
