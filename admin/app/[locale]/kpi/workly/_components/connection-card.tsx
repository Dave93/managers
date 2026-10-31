"use client";
// Карточка подключения Workly одной организации: настроено ли подключение, последний прогон,
// кнопка «Проверить» и сверка сотрудников по прогону, за которым следит карточка.
//
// Состояние карточки — id отслеживаемого прогона проверки (runId):
//   null → только строка последнего прогона из статуса;
//   прогон загружается → «Загружаем прогон…»;
//   running → «Идёт обход Workly», опрос каждые 2 секунды, «Проверить» недоступна;
//     с 4 минут ещё «Занимает дольше обычного»; с 16 минут (runStaleness: stuck) — «Проверка
//     зависла», «Проверить» снова доступна (новый запуск закрывает брошенную строку на сервере);
//   planned → PlanReview с исключениями и «Применить»;
//   applied / rolled_back → PlanReview без «Применить», с итогом;
//   failed → текст по коду ошибки, «Проверить» снова доступна;
//   blocked → причина остановки (бывает только у ночного прогона).
// После перезагрузки страницы опрос продолжается сам: если последний прогон в статусе — идущая
// проверка сотрудников, карточка начинает следить за ним. Готовый план открывается кнопкой.

import React, { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { kpiApi, type RunRow, type WorklyStatusEntry } from "@admin/lib/kpi-api";
import { formatTashkent } from "@admin/lib/kpi/format";
import type { Tone } from "@admin/lib/kpi/status";
import { RUN_STATUSES, plannedRunId, resumeRunId } from "@admin/lib/kpi/workly-view";
import { KpiBadge } from "../../_components/kpi-badge";
import { qk } from "../../_components/use-kpi";
import { PlanReview } from "./plan-review";
import { useWorklyRun, type Staleness } from "./use-workly-run";
import { useWorklyText } from "./workly-text";

const STATUS_TONE: Record<RunRow["status"], Tone> = {
  running: "blue",
  planned: "amber",
  applied: "green",
  blocked: "amber",
  failed: "red",
  rolled_back: "gray",
};
const RUN_KINDS = ["employees", "attendance"] as const;
const TRIGGERS = ["manual", "schedule"] as const;

/** Значение из списка или null: так строка из базы сужается до известного типа. */
function oneOf<T extends string>(list: readonly T[], value: string): T | null {
  return (list as readonly string[]).includes(value) ? (value as T) : null;
}

export function ConnectionCard({ entry }: { entry: WorklyStatusEntry }) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();
  const qc = useQueryClient();
  const headingId = useId();
  const orgId = entry.organization_id;

  // Карточка монтируется, когда статус уже загружен: идущая проверка подхватывается сразу.
  const resumable = resumeRunId(entry);
  const [runId, setRunId] = useState<string | null>(resumable);
  // Статус обновился и показал новую идущую проверку (например, её запустили в другой вкладке):
  // следим за ней. Отслеживаемый id не сбрасывается, когда last_run меняется, иначе план
  // пропал бы сразу после конца обхода.
  const [seenResumable, setSeenResumable] = useState(resumable);
  if (resumable !== seenResumable) {
    setSeenResumable(resumable);
    if (resumable) setRunId(resumable);
  }

  // Ошибка старта относится к прогону, который карточка показывала в момент нажатия: когда
  // карточка переходит к другому прогону (после 409 run_in_progress — к идущему), ошибка скрывается.
  const [startError, setStartError] = useState<{ error: unknown; runId: string | null } | null>(null);
  const start = useMutation({
    // Аргумент — прогон, который был на экране при нажатии; запросу он не нужен.
    mutationFn: (_shownRunId: string | null) => kpiApi.workly.plan(orgId as string),
    onMutate: () => setStartError(null),
    onSuccess: (r) => {
      setRunId(r.run_id);
      qc.invalidateQueries({ queryKey: qk.worklyStatus });
    },
    onError: (e, shownRunId) => {
      setStartError({ error: e, runId: shownRunId });
      // 409 run_in_progress: статус покажет идущую проверку, и карточка начнёт следить за ней.
      qc.invalidateQueries({ queryKey: qk.worklyStatus });
    },
  });

  // Опрос каждые 2 секунды, пока running; конец прогона обновляет статус подключения один раз.
  // Зависшая проверка (воркер не отвечает) снова открывает «Проверить»: новый запуск закроет
  // её на сервере (use-workly-run.ts).
  const { run, staleness, busy } = useWorklyRun(runId);
  const available = entry.configured && orgId != null;
  const canStart = available && !start.isPending && !busy;
  const check = () => {
    if (canStart) start.mutate(runId);
  };

  const planned = plannedRunId(entry);
  const canOpenPlan = planned != null && planned !== runId && !busy && !start.isPending;

  return (
    <article aria-labelledby={headingId} className="space-y-4 rounded-md border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 id={headingId} className="text-base font-medium break-words">
            {entry.organization_name}
          </h3>
          {!entry.configured ? (
            <div className="space-y-1">
              <KpiBadge tone="amber">{t("card.notConfigured")}</KpiBadge>
              <p className="text-sm text-muted-foreground">{t("card.notConfiguredHint")}</p>
            </div>
          ) : orgId == null ? (
            <div className="space-y-1">
              <KpiBadge tone="red">{t("card.noOrganization")}</KpiBadge>
              <p className="text-sm text-muted-foreground">{t("card.noOrganizationHint")}</p>
            </div>
          ) : (
            <KpiBadge tone="green">{t("card.configured")}</KpiBadge>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {canOpenPlan && (
            <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setRunId(planned)}>
              {t("card.openPlan")}
            </Button>
          )}
          <Button
            type="button"
            className="h-11 w-full sm:w-auto"
            disabled={!canStart}
            aria-label={t("card.checkAria", { name: entry.organization_name })}
            onClick={check}
          >
            {(start.isPending || busy) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {t("card.check")}
          </Button>
        </div>
      </div>

      <LastRun entry={entry} trackedId={runId} />

      {startError != null && startError.runId === runId && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {text.apiError(startError.error)}
        </p>
      )}

      {runId != null && (
        <RunBody
          run={run.data}
          staleness={staleness}
          loadError={run.error}
          organizationId={orgId}
          organizationName={entry.organization_name}
          onRecheck={check}
          rechecking={start.isPending}
        />
      )}
    </article>
  );
}

/** Строка последнего прогона из статуса: вид, статус, источник, время и причина остановки или ошибка. */
function LastRun({ entry, trackedId }: { entry: WorklyStatusEntry; trackedId: string | null }) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();
  const last = entry.last_run;
  if (!last) return <p className="text-sm text-muted-foreground">{t("card.noRuns")}</p>;
  // Ошибку и причину отслеживаемого прогона показывает его блок ниже: не повторяем.
  const own = last.id === trackedId;
  // В статусе вид, источник и статус — строки из базы: незнакомое значение показывается как есть.
  const status = oneOf(RUN_STATUSES, last.status);
  const kind = oneOf(RUN_KINDS, last.kind);
  const trigger = oneOf(TRIGGERS, last.trigger);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t("card.lastRun")}</span>
        <KpiBadge tone={status ? STATUS_TONE[status] : "gray"}>{status ? t(`card.status.${status}`) : last.status}</KpiBadge>
        <span className="break-words">
          {t("card.runLine", {
            kind: kind ? t(`card.kind.${kind}`) : last.kind,
            trigger: trigger ? t(`card.trigger.${trigger}`) : last.trigger,
            time: formatTashkent(last.created_at),
          })}
        </span>
      </div>
      {last.kind === "attendance" && last.status === "running" && (
        <p className="text-muted-foreground">{t("card.attendanceRunning")}</p>
      )}
      {!own && last.status === "blocked" && <p className="text-amber-700">{text.blocked(last.block_reason)}</p>}
      {!own && last.status === "failed" && <p className="text-destructive">{text.runError(last.error)}</p>}
    </div>
  );
}

function RunBody({
  run,
  staleness,
  loadError,
  organizationId,
  organizationName,
  onRecheck,
  rechecking,
}: {
  run: RunRow | undefined;
  staleness: Staleness;
  loadError: Error | null;
  organizationId: string | null;
  organizationName: string;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();

  if (!run) {
    if (loadError)
      return (
        <p role="alert" className="text-sm text-destructive">
          {text.apiError(loadError)}
        </p>
      );
    return <p className="text-sm text-muted-foreground">{t("card.loadingRun")}</p>;
  }

  if (run.status === "running") {
    if (staleness === "stuck")
      return (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("card.stuck")}
        </p>
      );
    return (
      <div role="status" className="space-y-1 rounded-md bg-muted p-3 text-sm">
        <p className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("card.running")}
        </p>
        {staleness === "slow" && <p className="text-amber-700">{t("card.slow")}</p>}
      </div>
    );
  }

  if (run.status === "failed")
    return (
      <div role="alert" className="space-y-0.5 rounded-md border border-destructive p-3 text-sm text-destructive">
        <p className="font-medium">{t("card.failed")}</p>
        <p>{text.runError(run.error)}</p>
      </div>
    );

  if (run.status === "blocked")
    return (
      <div role="alert" className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">{t("card.blocked")}</p>
        <p>{text.blocked(run.block_reason)}</p>
      </div>
    );

  // planned, applied, rolled_back. Ключ — id прогона: новый прогон сбрасывает исключения и итог.
  return (
    <section aria-label={t("card.reviewAria", { name: organizationName })} className="space-y-3 border-t pt-4">
      <h4 className="text-sm font-semibold">{t("card.reviewHeading")}</h4>
      {organizationId != null && (
        <PlanReview
          key={run.id}
          run={run}
          organizationId={organizationId}
          organizationName={organizationName}
          onRecheck={onRecheck}
          rechecking={rechecking}
        />
      )}
    </section>
  );
}
