"use client";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { kpiApi, type EmployeeRow } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL, employeeName, terminalOptions } from "@admin/lib/kpi/filters";
import { bindingLabel } from "@admin/lib/kpi/telegram";
import { InviteDialog } from "../_components/invite-dialog";
import { KpiBadge } from "../_components/kpi-badge";
import { ScreenGate } from "../_components/screen-gate";
import { StaleNote } from "../_components/stale-note";
import { qk, useKpiMe } from "../_components/use-kpi";
import { useTgBindings } from "../_components/use-tg-bindings";

export default function StaffPage() {
  return (
    <ScreenGate screen="staff">
      <StaffScreen />
    </ScreenGate>
  );
}

/** Менеджер филиала подключает Telegram своим сотрудникам: показывает QR, сотрудник сканирует его своим телефоном. */
function StaffScreen() {
  const t = useTranslations("kpiScreens.staff");
  const tk = useTranslations("kpi");
  const me = useKpiMe();
  const [terminal, setTerminal] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [onlyUnbound, setOnlyUnbound] = useState(false);
  // Храним id: пока окно открыто, статус привязки берётся из свежей загрузки.
  const [inviteId, setInviteId] = useState<string | null>(null);

  const period = me.data?.current_period;
  const list = useQuery<EmployeeRow[], Error>({
    queryKey: period ? qk.employees({ period }) : [...qk.employeesAll, "idle"],
    queryFn: () => kpiApi.employees.list({ period: period! }),
    enabled: !!period,
    retry: shouldRetry,
  });
  // Список периода держит и уволенных с оценкой за месяц: приглашение им не нужно.
  const rows = useMemo(() => (list.data ?? []).filter((r) => r.active), [list.data]);
  const tg = useTgBindings("employee", rows.map((r) => r.id));
  const tgLoad = loadErrors(tg);
  const load = loadErrors(me, list);

  const terminals = useMemo(() => terminalOptions(rows, tk), [rows, tk]);
  const inTerminal = useMemo(() => rows.filter((r) => terminal === ALL || r.terminal_id === terminal), [rows, terminal]);
  const visible = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return inTerminal.filter((r) => {
      if (words.length && !words.every((w) => employeeName(r).toLowerCase().includes(w))) return false;
      return !(onlyUnbound && tg.lookup(r.id).binding);
    });
  }, [inTerminal, search, onlyUnbound, tg.lookup]);

  // Счётчик показываем, только когда статус известен у всех: иначе «подключено 0 из 23» было бы ложью.
  const statusKnown = inTerminal.length > 0 && inTerminal.every((r) => tg.lookup(r.id).state === "ready");
  const connected = inTerminal.filter((r) => tg.lookup(r.id).binding).length;
  const invitee = rows.find((r) => r.id === inviteId) ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      </div>

      {load.blocking != null ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(load.blocking, tk)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {terminals.length > 1 && (
              <Select value={terminal} onValueChange={setTerminal}>
                <SelectTrigger className="h-11 w-full sm:w-60" aria-label={t("terminalAria")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t("allTerminals")}</SelectItem>
                  {terminals.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              aria-label={t("searchAria")}
              placeholder={t("searchPlaceholder")}
              className="h-11 min-w-0 flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="button" variant={onlyUnbound ? "default" : "outline"} className="h-11" aria-pressed={onlyUnbound} onClick={() => setOnlyUnbound((v) => !v)}>
              {t("onlyUnbound")}
            </Button>
          </div>

          {statusKnown && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("connected", { connected, total: inTerminal.length })}</p>
              <div
                role="progressbar"
                aria-label={t("progressAria")}
                aria-valuemin={0}
                aria-valuemax={inTerminal.length}
                aria-valuenow={connected}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-green-600" style={{ width: `${(connected / inTerminal.length) * 100}%` }} />
              </div>
            </div>
          )}

          {tgLoad.blocking != null && (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {kpiErrorText(tgLoad.blocking, tk)}
            </p>
          )}
          {(load.stale ?? tgLoad.stale) != null && <StaleNote error={load.stale ?? tgLoad.stale} />}

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{onlyUnbound && !search.trim() ? t("allConnected") : t("noMatches")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {visible.map((r) => {
                const { binding, state } = tg.lookup(r.id);
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="break-words font-medium">{employeeName(r)}</div>
                      <div className="break-words text-xs text-muted-foreground">
                        {[r.staff_role_name, terminals.length > 1 && terminal === ALL ? r.terminal_name : null].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {state === "ready" ? (
                        <KpiBadge tone={binding ? "green" : "gray"}>{bindingLabel(binding, tk)}</KpiBadge>
                      ) : (
                        <span className="text-sm text-muted-foreground" aria-label={t("statusUnknownAria")}>
                          {state === "loading" ? "…" : "—"}
                        </span>
                      )}
                      {/* Статус неизвестен: «Новый QR» или «QR» подписать нечем, поэтому кнопку не показываем. */}
                      {state === "ready" && (
                        <Button
                          type="button"
                          variant={binding ? "outline" : "default"}
                          className="h-11"
                          aria-label={t(binding ? "newQrAria" : "qrAria", { name: employeeName(r) })}
                          onClick={() => setInviteId(r.id)}
                        >
                          {binding ? t("newQr") : t("qr")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {invitee && (
        <InviteDialog
          target={{ employee_id: invitee.id }}
          name={employeeName(invitee)}
          binding={tg.lookup(invitee.id).binding}
          open
          autoCreate
          onClose={() => setInviteId(null)}
        />
      )}
    </div>
  );
}
