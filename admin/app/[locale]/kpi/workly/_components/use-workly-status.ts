"use client";
// Статус подключений Workly (GET /workly/status): один запрос с одними настройками для всех,
// кто его читает, — карточки подключений, выбор организации в разделах экрана Workly, мастер
// файловой загрузки и таблица загрузок посещаемости. Ключ общий, поэтому кэш тоже один.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { kpiApi, type WorklyStatusEntry } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { qk } from "../../_components/use-kpi";

export function useWorklyStatus(): UseQueryResult<WorklyStatusEntry[], Error> {
  return useQuery<WorklyStatusEntry[], Error>({
    queryKey: qk.worklyStatus,
    queryFn: () => kpiApi.workly.status(),
    retry: shouldRetry,
  });
}
