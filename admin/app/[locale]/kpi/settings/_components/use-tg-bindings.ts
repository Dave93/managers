"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { kpiApi, type TgBindingRow } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { chunkIds, indexBindings } from "@admin/lib/kpi/telegram";
import { qk } from "../../_components/use-kpi";

/** Привязки Telegram для набора сотрудников или пользователей: id → привязка. Нет записи — не привязан. */
export function useTgBindings(
  kind: "employee" | "user",
  ids: string[]
): { data: Map<string, TgBindingRow> | undefined; isLoading: boolean } {
  // Ключ запроса — отсортированные уникальные id: порядок строк таблицы его не меняет.
  const key = useMemo(() => [...new Set(ids.filter(Boolean))].sort(), [ids]);
  const q = useQuery<Map<string, TgBindingRow>, Error>({
    queryKey: qk.tgBindings(kind, key),
    queryFn: async () => {
      const parts = await Promise.all(
        chunkIds(key).map((chunk) =>
          kpiApi.tg.bindings(kind === "employee" ? { employee_ids: chunk } : { user_ids: chunk })
        )
      );
      return indexBindings(parts.flat())[kind];
    },
    enabled: key.length > 0,
    retry: shouldRetry,
  });
  return { data: q.data, isLoading: q.isLoading };
}
