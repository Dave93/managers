"use client";
// Карта локаций Workly → терминал одной организации (раздел 5.4 спеки, R30).
//
// Таблица читается из базы без обращения к Workly и пуста, пока не нажата «Загрузить локации
// из Workly» (один синхронный запрос на несколько секунд) или не прошёл первый «Проверить».
// Новые локации приходят с терминалом-подсказкой по названию: HR подтверждает карту до
// первого «Проверить». Терминалы в выборе — только активные терминалы этой организации.
// Смена терминала сразу сохраняется (setLocation): у строки своё ожидание, затем таблица
// перечитывается. Локации без терминала выделены и подписаны: при создании сотрудников они
// не используются. На узком экране строка складывается в столбик (локация, под ней выбор
// терминала), иначе выбор уезжал за край экрана.

import React, { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type WorklyLocationRow, type WorklyTerminalRow } from "@admin/lib/kpi-api";
import { loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { shortId } from "@admin/lib/kpi/workly-view";
import { cn } from "@admin/lib/utils";
import { StaleNote } from "../../_components/stale-note";
import { qk } from "../../_components/use-kpi";
import { WithOrganization, type ConnectedEntry } from "./organization-select";
import { useWorklyText } from "./workly-text";

// Radix Select не принимает пустое значение у пункта: «не привязан» — отдельный маркер.
const NONE = "__none__";

export function LocationsSection() {
  const t = useTranslations("kpiScreens.workly");
  return (
    <section aria-labelledby="workly-locations" className="space-y-3">
      <h2 id="workly-locations" className="text-base font-medium">
        {t("locations.heading")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("locations.intro")}</p>
      <WithOrganization>
        {(entry, select) => (
          <div className="space-y-3">
            {select}
            {/* key: другая организация — свои запросы и своё состояние кнопки. */}
            <LocationsTable key={entry.organization_id} entry={entry} />
          </div>
        )}
      </WithOrganization>
    </section>
  );
}

function LocationsTable({ entry }: { entry: ConnectedEntry }) {
  const t = useTranslations("kpiScreens.workly");
  const tc = useTranslations("kpiScreens.common");
  const text = useWorklyText();
  const qc = useQueryClient();
  const orgId = entry.organization_id;

  const list = useQuery<WorklyLocationRow[], Error>({
    queryKey: qk.worklyLocations(orgId),
    queryFn: () => kpiApi.workly.locations(orgId),
    retry: shouldRetry,
  });
  const terms = useQuery<WorklyTerminalRow[], Error>({
    queryKey: qk.worklyTerminals(orgId),
    queryFn: () => kpiApi.workly.terminals(orgId),
    retry: shouldRetry,
    staleTime: 10 * 60 * 1000,
  });

  const refresh = useMutation({
    mutationFn: () => kpiApi.workly.locationsRefresh(orgId),
    onSuccess: (rows) => {
      // Ответ — уже вся карта организации: подставляем его, отдельный запрос не нужен.
      qc.setQueryData(qk.worklyLocations(orgId), rows);
      toast.success(t("locations.refreshed", { count: rows.length }));
    },
  });

  const { blocking, stale } = loadErrors(list);
  const rows = list.data ?? [];
  const unmapped = rows.filter((r) => r.terminal_id == null).length;
  const empty = !list.isPending && !blocking && rows.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant={empty ? "default" : "outline"}
          className="h-11 w-full sm:w-auto"
          disabled={refresh.isPending}
          aria-label={t("locations.refreshAria", { name: entry.organization_name })}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t("locations.refresh")}
        </Button>
        {refresh.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("locations.refreshing")}
          </p>
        )}
      </div>

      {refresh.error != null && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {text.apiError(refresh.error)}
        </p>
      )}

      {blocking ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {text.apiError(blocking)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm">{t("locations.empty")}</p>
      ) : (
        <div className="space-y-2">
          {stale != null && <StaleNote error={stale} />}
          {terms.error != null && terms.data === undefined && (
            <p role="alert" className="text-sm text-destructive">
              {t("locations.terminalsError")} {text.apiError(terms.error)}
            </p>
          )}
          <p className="text-sm">
            {unmapped > 0
              ? t("locations.unmappedCount", { count: unmapped, total: rows.length })
              : t("locations.allMapped", { total: rows.length })}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table aria-label={t("locations.tableAria", { name: entry.organization_name })}>
              {/* На телефоне ячейки идут столбиком, и шапка из двух колонок не нужна: у выбора своя подпись. */}
              <TableHeader className="hidden sm:table-header-group">
                <TableRow>
                  <TableHead>{t("locations.colLocation")}</TableHead>
                  <TableHead>{t("locations.colTerminal")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <LocationRow key={r.id} row={r} orgId={orgId} terminals={terms.data} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function LocationRow({
  row,
  orgId,
  terminals,
}: {
  row: WorklyLocationRow;
  orgId: string;
  /** undefined — список терминалов ещё грузится или не загрузился: выбор недоступен. */
  terminals: WorklyTerminalRow[] | undefined;
}) {
  const t = useTranslations("kpiScreens.workly");
  const text = useWorklyText();
  const qc = useQueryClient();

  // У каждой строки своя мутация: при двух быстрых правках ожидание видно у обеих.
  const save = useMutation({
    mutationFn: (terminalId: string | null) => kpiApi.workly.setLocation(row.id, terminalId),
    // Ожидание держится до конца перечитывания таблицы: иначе на миг мелькнуло бы старое значение.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.worklyLocations(orgId) }),
  });

  // Пока списка терминалов нет (грузится или ошибка), выбор закрыт, а привязанный терминал
  // показывается просто по названию. Когда список есть, привязанный терминал может в него не
  // входить (выключен или перенесён в другую организацию): тогда он отдельный пункт с пометкой,
  // иначе выбор выглядел бы пустым.
  const options = useMemo(() => {
    const current = row.terminal_id == null ? null : { id: row.terminal_id, name: row.terminal_name ?? shortId(row.terminal_id) };
    if (terminals === undefined) return { list: [], plain: current, extra: null };
    if (current == null || terminals.some((x) => x.id === current.id)) return { list: terminals, plain: null, extra: null };
    return { list: terminals, plain: null, extra: current };
  }, [terminals, row.terminal_id, row.terminal_name]);

  const current = save.isPending ? save.variables : row.terminal_id;
  const unmapped = row.terminal_id == null;

  return (
    <TableRow className={cn("block sm:table-row", unmapped && "bg-amber-50 hover:bg-amber-100/70")}>
      {/* Общая ячейка таблицы не переносит строки (whitespace-nowrap): здесь перенос нужен. */}
      <TableCell className="block whitespace-normal align-top sm:table-cell">
        <div className="min-w-0 space-y-0.5 sm:min-w-[10rem]">
          <p className="break-words font-medium">{row.title || t("locations.noTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("locations.worklyId", { id: row.workly_location_id })}</p>
          {unmapped && <p className="text-xs font-medium text-amber-800">{t("locations.unmapped")}</p>}
        </div>
      </TableCell>
      <TableCell className="block whitespace-normal pt-0 align-top sm:table-cell sm:pt-2">
        <div className="min-w-0 space-y-1 sm:min-w-[14rem]">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Select
              value={current ?? NONE}
              onValueChange={(v) => save.mutate(v === NONE ? null : v)}
              disabled={save.isPending || terminals === undefined}
            >
              <SelectTrigger
                className="h-11 w-full sm:w-72"
                aria-label={t("locations.terminalAria", { name: row.title || String(row.workly_location_id) })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("locations.none")}</SelectItem>
                {options.plain && <SelectItem value={options.plain.id}>{options.plain.name}</SelectItem>}
                {options.extra && (
                  <SelectItem value={options.extra.id}>{t("locations.otherTerminal", { name: options.extra.name })}</SelectItem>
                )}
                {options.list.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {save.isPending && (
              <span role="status" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("locations.saving")}
              </span>
            )}
          </div>
          {save.error != null && (
            <p role="alert" className="text-xs text-destructive">
              {text.apiError(save.error)}
            </p>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
