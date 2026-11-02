"use client";
// Опрос фонового прогона Workly (проверка сотрудников или синхронизация посещаемости).
// Общий для карточки подключения и блока «Посещаемость»:
//   - строка прогона читается каждые 2 секунды, пока он running (pollInterval);
//   - прогон вышел из running — статус подключений обновляется один раз, затем onEnd;
//   - staleness: с 4 минут slow, с 16 минут stuck (runStaleness). «Сейчас» — момент последнего
//     ответа опроса: он обновляется каждые 2 секунды, так что оценка пересчитывается сама;
//   - busy: прогон загружается или идёт и не завис; зависший снова открывает кнопку запуска
//     (новый запуск закрывает брошенную строку на сервере).

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { kpiApi, type RunRow } from "@admin/lib/kpi-api";
import { shouldRetry } from "@admin/lib/kpi/errors";
import { isRunning, pollInterval } from "@admin/lib/kpi/workly";
import { runStaleness } from "@admin/lib/kpi/workly-view";
import { qk } from "../../_components/use-kpi";

export type Staleness = ReturnType<typeof runStaleness>;

export function useWorklyRun(runId: string | null, onEnd?: (run: RunRow) => void) {
  const qc = useQueryClient();
  const run = useQuery<RunRow, Error>({
    queryKey: qk.worklyRun(runId ?? ""),
    queryFn: () => kpiApi.workly.run(runId as string),
    enabled: runId != null,
    retry: shouldRetry,
    refetchInterval: (q) => pollInterval(q.state.data),
  });

  // Последний обработчик без перезапуска эффекта: вызывающий передаёт новую функцию на каждом рендере.
  // Эффект объявлен раньше эффекта ниже, поэтому в том же коммите он срабатывает первым.
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  // Прогон вышел из running (план готов, ошибка, применён): реакция один раз на пару id:статус.
  const ended = useRef<string | null>(null);
  const data = run.data;
  const runKey = data ? `${data.id}:${data.status}` : null;
  useEffect(() => {
    if (!data || !runKey || runKey.endsWith(":running") || ended.current === runKey) return;
    ended.current = runKey;
    qc.invalidateQueries({ queryKey: qk.worklyStatus });
    onEndRef.current?.(data);
  }, [runKey, data, qc]);

  const shown = run.data;
  const staleness: Staleness =
    shown && isRunning(shown) ? runStaleness(shown.created_at, Math.max(run.dataUpdatedAt, run.errorUpdatedAt)) : "ok";
  const busy = runId != null && (run.isPending || (isRunning(shown) && staleness !== "stuck"));
  return { run, staleness, busy };
}
