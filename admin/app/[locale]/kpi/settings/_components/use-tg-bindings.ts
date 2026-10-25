"use client";

import { useCallback } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { kpiApi, type TgBindingRow } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { chunkIds, indexBindings } from "@admin/lib/kpi/telegram";
import { qk } from "../../_components/use-kpi";

/** Статус привязки в ячейке: пока данных нет или загрузка не удалась, «не привязан» говорить нельзя. */
export type TgState = "loading" | "error" | "ready";

/**
 * Привязки Telegram для набора сотрудников или пользователей. `lookup(id)` отдаёт привязку и состояние:
 * нет записи при `ready` — не привязан; при `loading`/`error` статус неизвестен.
 */
export function useTgBindings(kind: "employee" | "user", ids: string[]) {
  // Ключ запроса — строка из отсортированных уникальных id: порядок строк таблицы его не меняет.
  const joined = [...new Set(ids.filter(Boolean))].sort().join(",");
  const q = useQuery<Map<string, TgBindingRow>, Error>({
    queryKey: qk.tgBindings(kind, joined ? joined.split(",") : []),
    queryFn: async () => {
      const parts = await Promise.all(
        chunkIds(joined.split(",")).map((chunk) =>
          kpiApi.tg.bindings(kind === "employee" ? { employee_ids: chunk } : { user_ids: chunk })
        )
      );
      return indexBindings(parts.flat())[kind];
    },
    enabled: joined !== "",
    retry: shouldRetry,
    // При смене поиска или филиала таблица не мигает: пока грузится новый набор, видны прежние привязки.
    placeholderData: keepPreviousData,
  });

  const { data, error, isPlaceholderData } = q;
  const lookup = useCallback(
    (id: string): { binding: TgBindingRow | undefined; state: TgState } => {
      if (joined === "") return { binding: undefined, state: "ready" };
      if (data === undefined) return { binding: undefined, state: error ? "error" : "loading" };
      const binding = data.get(id);
      // Прежний набор не знает о новых строках: их статус ещё неизвестен.
      if (isPlaceholderData && !binding) return { binding: undefined, state: "loading" };
      return { binding, state: "ready" };
    },
    [joined, data, error, isPlaceholderData]
  );
  return { lookup, error, data };
}
