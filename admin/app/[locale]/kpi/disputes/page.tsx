"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { kpiApi, type DisputeRow } from "@admin/lib/kpi-api";
import { splitDisputes, subjectLabel } from "@admin/lib/kpi/disputes";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { periodOptions } from "@admin/lib/kpi/periods";
import { DISPUTE_STATUS } from "@admin/lib/kpi/status";
import { KpiBadge } from "../_components/kpi-badge";
import { PeriodSelect } from "../_components/period-select";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk } from "../_components/use-kpi";
import { ResolveDialog } from "./_components/resolve-dialog";

export default function DisputesPage() {
  return (
    <ScreenGate screen="disputes">
      <DisputesScreen />
    </ScreenGate>
  );
}

function DisputesScreen() {
  const t = useTranslations("kpiScreens.disputes");
  const tc = useTranslations("kpiScreens.common");
  const tk = useTranslations("kpi");
  const now = useMemo(() => new Date(), []);
  // null — «Все месяцы»: параметр period на сервер не уходит.
  const [period, setPeriod] = useState<string | null>(null);
  // Храним id: после разбора список обновляется, и диалог берёт свежую строку.
  const [resolveId, setResolveId] = useState<string | null>(null);

  const options = useMemo(() => periodOptions(now, 12), [now]);

  const query = useMemo(() => (period ? { period } : {}), [period]);
  const list = useQuery({
    queryKey: qk.disputes(query),
    queryFn: () => kpiApi.disputes.list(query),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const { open, closed } = useMemo(() => splitDisputes(rows), [rows]);
  const resolveRow = resolveId ? rows.find((d) => d.id === resolveId) ?? null : null;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-xl font-semibold">{t("title")}</h1>
        <PeriodSelect value={period} onChange={setPeriod} options={options} allowAll className="w-44" />
      </div>

      {/* Ошибка заменяет список, только пока данных нет; сбой фонового обновления — предупреждение над списком. */}
      {list.error != null && list.data !== undefined && <StaleNote error={list.error} />}

      {list.error != null && list.data === undefined ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error, tk)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      ) : (
        <Tabs defaultValue="open">
          <TabsList>
            <TabsTrigger value="open">{t("tabOpen", { count: open.length })}</TabsTrigger>
            <TabsTrigger value="closed">{t("tabClosed")}</TabsTrigger>
          </TabsList>
          <TabsContent value="open" className="mt-3">
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOpen")}</p>
            ) : (
              <DisputeList rows={open} onResolve={(d) => setResolveId(d.id)} />
            )}
          </TabsContent>
          <TabsContent value="closed" className="mt-3">
            {closed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noClosed")}</p>
            ) : (
              <DisputeList rows={closed} onResolve={(d) => setResolveId(d.id)} />
            )}
          </TabsContent>
        </Tabs>
      )}

      <ResolveDialog dispute={resolveRow} onClose={() => setResolveId(null)} />
    </div>
  );
}

function DisputeList({ rows, onResolve }: { rows: DisputeRow[]; onResolve: (d: DisputeRow) => void }) {
  const t = useTranslations("kpiScreens.disputes");
  const tk = useTranslations("kpi");
  const locale = useLocale();
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((d) => {
        const st = DISPUTE_STATUS[d.status];
        return (
          <li key={d.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{formatTashkent(d.created_at)}</span>
              <KpiBadge tone={st.tone}>{tk(st.labelKey)}</KpiBadge>
              {d.opened_via === "telegram" && <span className="text-xs text-muted-foreground">{t("viaTelegram")}</span>}
              {d.opened_via === "miniapp" && <span className="text-xs text-muted-foreground">{t("viaMiniapp")}</span>}
            </div>
            <div>
              <div className="font-medium">{d.employee_name ?? t("noEmployee")}</div>
              <div className="text-sm text-muted-foreground">{d.terminal_name ?? t("noTerminal")}</div>
            </div>
            <div className="text-sm">{subjectLabel(d, tk, locale)}</div>
            <p className="whitespace-pre-wrap break-words text-sm">{d.reason}</p>
            {d.status !== "open" && (
              <div className="space-y-1 rounded bg-muted/50 p-2 text-sm">
                <p className="whitespace-pre-wrap break-words">{d.resolution_comment ?? "—"}</p>
                <div className="text-xs text-muted-foreground">
                  {d.resolved_by_name ?? "—"}, {formatTashkent(d.resolved_at)}
                </div>
              </div>
            )}
            {d.can_resolve && d.status === "open" && (
              <div className="pt-1">
                <Button type="button" className="h-11" onClick={() => onResolve(d)}>
                  {t("resolveButton")}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
