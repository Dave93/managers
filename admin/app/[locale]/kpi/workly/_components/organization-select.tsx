"use client";
// Выбор организации в разделах «Локации» и «Посещаемость». Варианты — подключения из статуса,
// у которых организация есть в базе (organization_id не null). Выбор хранится в состоянии
// раздела: у каждого раздела свой, и обновление статуса его не сбрасывает.

import React, { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { kpiApi, type WorklyStatusEntry } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { qk } from "../../_components/use-kpi";

/** Подключение, организация которого найдена в базе. */
export type ConnectedEntry = WorklyStatusEntry & { organization_id: string };

/**
 * Организация раздела. Пока человек не выбрал сам, берётся первая подходящая под prefer
 * (например, та, у которой идёт синхронизация), иначе первая; выбор фиксируется сразу,
 * поэтому не перескакивает, когда прогон закончится и статус обновится.
 */
function useOrganizationChoice(
  entries: ConnectedEntry[],
  prefer?: (e: ConnectedEntry) => boolean
): [ConnectedEntry | null, (id: string) => void] {
  const [picked, setPicked] = useState<string | null>(null);
  if (picked == null && entries.length > 0) {
    setPicked(((prefer && entries.find(prefer)) ?? entries[0]).organization_id);
  }
  const entry = entries.find((e) => e.organization_id === picked) ?? entries[0] ?? null;
  return [entry, setPicked];
}

/**
 * Загружает статус подключений и отдаёт выбранную организацию и готовый переключатель
 * разделу (render-prop). Пока статус грузится, при ошибке и без организаций показывает
 * текст вместо раздела.
 */
export function WithOrganization({
  prefer,
  children,
}: {
  prefer?: (e: ConnectedEntry) => boolean;
  children: (entry: ConnectedEntry, select: React.ReactNode) => React.ReactNode;
}) {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const labelId = useId();
  const status = useQuery<WorklyStatusEntry[], Error>({
    queryKey: qk.worklyStatus,
    queryFn: () => kpiApi.workly.status(),
    retry: shouldRetry,
  });
  const entries = useMemo(
    () => (status.data ?? []).filter((e): e is ConnectedEntry => e.organization_id != null),
    [status.data]
  );
  const [entry, pick] = useOrganizationChoice(entries, prefer);

  if (status.isPending) return <p className="text-sm text-muted-foreground">{tc("loading")}</p>;
  if (!entry) {
    if (status.error)
      return (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(status.error, tk)}
        </p>
      );
    return <p className="text-sm text-muted-foreground">{t("connections.noOrganizations")}</p>;
  }

  const select = (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span id={labelId} className="text-sm text-muted-foreground">
        {t("connections.organization")}
      </span>
      <Select value={entry.organization_id} onValueChange={pick}>
        <SelectTrigger aria-labelledby={labelId} className="h-11 w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {entries.map((e) => (
            <SelectItem key={e.key} value={e.organization_id}>
              {e.organization_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return <>{children(entry, select)}</>;
}
