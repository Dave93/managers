"use client";
// Синхронизация посещаемости организации за месяц (раздел 5.6 спеки) и качество данных.
//
// «Синхронизировать» ставит фоновую задачу (202, run_id) и опрашивает прогон так же, как
// «Проверить» в карточке подключения (use-workly-run.ts): каждые 2 секунды, пока running;
// с 4 минут «дольше обычного», с 16 минут — «зависла», и кнопка снова доступна (новый запуск
// закроет брошенную строку на сервере). Ошибки до постановки задачи (закрытый или не начавшийся
// месяц, нет подключения, уже идёт, очередь недоступна) приходят ответом и показываются сразу.
// После перезагрузки страницы идущая синхронизация организации подхватывается из статуса
// вместе со своим месяцем. Перед кнопкой — предупреждение, если у организации за месяц уже есть
// файловый импорт: синхронизация его заменит (R23). Ниже — качество данных за выбранный месяц.

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { kpiApi, type AttendanceImportRow, type RunRow } from "@admin/lib/kpi-api";
import { KpiApiError, shouldRetry } from "@admin/lib/kpi/errors";
import { calendarPeriod, monthLabel, periodOptions } from "@admin/lib/kpi/periods";
import { RUN_STATUSES, attendanceResultLines, fileImportWarning, resumeAttendanceRun } from "@admin/lib/kpi/workly-view";
import { PeriodSelect } from "../../_components/period-select";
import { qk, useKpiMe } from "../../_components/use-kpi";
import { WithOrganization, type ConnectedEntry } from "./organization-select";
import { QualityReport } from "./quality-report";
import { useWorklyRun, type Staleness } from "./use-workly-run";
import { useWorklyText } from "./workly-text";

export function AttendanceSection() {
  const t = useTranslations("kpiScreens.workly");
  return (
    <section aria-labelledby="workly-attendance" className="space-y-3">
      <h2 id="workly-attendance" className="text-base font-medium">
        {t("attendance.heading")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("attendance.intro")}</p>
      {/* Если у какой-то организации идёт синхронизация, сначала открывается она. */}
      <WithOrganization prefer={(e) => resumeAttendanceRun(e) != null}>
        {(entry, select) => (
          <div className="space-y-3">
            {select}
            {/* key: другая организация — свой прогон, своя ошибка и свой месяц. */}
            <AttendanceSync key={entry.organization_id} entry={entry} />
          </div>
        )}
      </WithOrganization>
    </section>
  );
}

function AttendanceSync({ entry }: { entry: ConnectedEntry }) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();
  const qc = useQueryClient();
  const locale = useLocale();
  const orgId = entry.organization_id;
  const now = useMemo(() => new Date(), []);
  const me = useKpiMe();
  const options = useMemo(() => periodOptions(now, 12), [now]);

  // Идущая синхронизация организации (после перезагрузки или запущенная в другой вкладке):
  // следим за ней и выбираем её месяц. Отслеживаемый id не сбрасывается, когда last_run
  // меняется, иначе итог пропал бы сразу после конца прогона.
  const resumable = resumeAttendanceRun(entry);
  const resumableId = resumable?.id ?? null;
  const [runId, setRunId] = useState<string | null>(resumableId);
  const [picked, setPicked] = useState<string | null>(resumable?.period ?? null);
  const [seenResumable, setSeenResumable] = useState(resumableId);
  if (resumableId !== seenResumable) {
    setSeenResumable(resumableId);
    if (resumable) {
      setRunId(resumable.id);
      if (resumable.period) setPicked(resumable.period);
    }
  }

  // Как на экране файловой загрузки: пока месяц не выбран, берётся текущий период сервера,
  // до его ответа — календарный. Месяц вне списка (например, месяц идущей синхронизации)
  // добавляется в список, иначе выбор окажется пустым.
  const period = picked ?? me.data?.current_period ?? calendarPeriod(now);
  const periods = options.includes(period) ? options : [period, ...options];

  const imports = useQuery<AttendanceImportRow[], Error>({
    queryKey: qk.attendanceImports(period),
    queryFn: () => kpiApi.attendance.imports(period),
    retry: shouldRetry,
  });
  const replacesFile = fileImportWarning(imports.data, orgId);

  // Ошибка старта относится к прогону, который был на экране при нажатии: когда блок переходит
  // к другому прогону (после 409 run_in_progress — к идущему), ошибка скрывается.
  const [startError, setStartError] = useState<{ error: unknown; runId: string | null } | null>(null);
  const start = useMutation({
    mutationFn: (v: { period: string; shownRunId: string | null }) => kpiApi.workly.attendanceSync(orgId, v.period),
    onMutate: () => setStartError(null),
    onSuccess: (r) => {
      setRunId(r.run_id);
      qc.invalidateQueries({ queryKey: qk.worklyStatus });
    },
    onError: (e, v) => {
      setStartError({ error: e, runId: v.shownRunId });
      // 409 run_in_progress: статус покажет идущую синхронизацию, и блок начнёт следить за ней.
      qc.invalidateQueries({ queryKey: qk.worklyStatus });
    },
  });

  // Синхронизация записала месяц: качество и список импортов (предупреждение о файле) устарели.
  const { run, staleness, busy } = useWorklyRun(runId, (r: RunRow) => {
    if (r.status !== "applied") return;
    qc.invalidateQueries({ queryKey: qk.worklyQualityAll });
    qc.invalidateQueries({ queryKey: qk.attendanceImportsAll });
  });

  const locked = busy || start.isPending;
  const sync = () => {
    if (!locked) start.mutate({ period, shownRunId: runId });
  };

  const startErrorText = (e: unknown) =>
    e instanceof KpiApiError && e.code === "run_in_progress" ? t("attendance.inProgress") : text.apiError(e);

  return (
    <div className="space-y-4">
      <PeriodSelect
        value={period}
        onChange={(v) => v && setPicked(v)}
        options={periods}
        className="h-11 w-full sm:w-60"
        disabled={locked}
      />

      {replacesFile && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {t("attendance.fileWarning")}
        </p>
      )}

      <Button
        type="button"
        className="h-11 w-full sm:w-auto"
        disabled={locked}
        aria-label={t("attendance.syncAria", { name: entry.organization_name, month: monthLabel(period, locale) })}
        onClick={sync}
      >
        {locked && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t("attendance.sync")}
      </Button>

      {startError != null && startError.runId === runId && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {startErrorText(startError.error)}
        </p>
      )}

      {runId != null && <RunResult run={run.data} staleness={staleness} loadError={run.error} />}

      <QualityReport organizationId={orgId} period={period} />
    </div>
  );
}

function RunResult({ run, staleness, loadError }: { run: RunRow | undefined; staleness: Staleness; loadError: Error | null }) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();
  const locale = useLocale();

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
          {t("attendance.stuck")}
        </p>
      );
    return (
      <div role="status" className="space-y-1 rounded-md bg-muted p-3 text-sm">
        <p className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("attendance.running", { month: run.period ? monthLabel(run.period, locale) : "—" })}
        </p>
        {staleness === "slow" && <p className="text-amber-700">{t("card.slow")}</p>}
      </div>
    );
  }

  if (run.status === "failed")
    return (
      <div role="alert" className="space-y-0.5 rounded-md border border-destructive p-3 text-sm text-destructive">
        <p className="font-medium">{t("attendance.failed")}</p>
        <p>{text.runError(run.error)}</p>
      </div>
    );

  if (run.status === "applied")
    return (
      <div role="status" className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-950">
        <p className="font-medium">{t("attendance.done", { month: run.period ? monthLabel(run.period, locale) : "—" })}</p>
        <ul className="space-y-1.5">
          {attendanceResultLines(run.counts).map((line) => (
            <li key={line.key}>
              <p className="font-medium tabular-nums">{t(line.label, { count: line.value })}</p>
              <p className="text-xs text-green-900">{t(line.hint)}</p>
            </li>
          ))}
        </ul>
      </div>
    );

  // У синхронизации посещаемости других статусов не бывает; на всякий случай — название статуса.
  const known = (RUN_STATUSES as readonly string[]).includes(run.status);
  return (
    <p className="text-sm text-muted-foreground">
      {t("card.lastRun")} {known ? t(`card.status.${run.status}`) : run.status}
    </p>
  );
}
