"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@admin/components/ui/alert-dialog";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type Card, type KpiUserOption, type ScopeRow } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { formatTashkent } from "@admin/lib/kpi/format";
import { groupScopes, scopeLabel } from "@admin/lib/kpi/settings";
import { MultiSelect } from "../../_components/multi-select";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiTerminals } from "../../_components/use-kpi";
import { TgCell } from "./tg-cell";
import { useTgBindings } from "../../_components/use-tg-bindings";

const MIN_SEARCH = 2;
const MAX_FOUND = 20;

export function EvaluatorsTab() {
  const t = useTranslations("kpi");
  const qc = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<ScopeRow | null>(null);

  const list = useQuery<ScopeRow[], Error>({
    queryKey: qk.evaluators,
    queryFn: () => kpiApi.evaluators.list(),
    retry: shouldRetry,
  });
  // Одна строка таблицы на человека: его охваты (карта + филиал) списком в одной ячейке.
  const groups = useMemo(() => groupScopes(list.data ?? []), [list.data]);

  const tg = useTgBindings("user", groups.map((g) => g.user_id));
  const tgLoad = loadErrors({ error: tg.error, data: tg.data });

  const remove = useMutation({
    mutationFn: (id: string) => kpiApi.evaluators.remove(id),
    onSuccess: () => toast.success(t("settings.evaluators.removed")),
    onError: (e) => toast.error(kpiErrorText(e, t)),
    // Инвалидация и при ошибке: после not_found устаревшая строка должна исчезнуть.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.evaluators });
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });

  return (
    <div className="space-y-4">
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        {t("settings.evaluators.hint")}
      </p>

      <AssignForm />

      {list.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error, t)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{t("settings.evaluators.loading")}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.evaluators.empty")}</p>
      ) : (
        <div className="space-y-2">
          {tgLoad.blocking != null && (
            <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
              {kpiErrorText(tgLoad.blocking, t)}
            </p>
          )}
          {tgLoad.stale != null && <StaleNote error={tgLoad.stale} />}
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.evaluators.colEvaluator")}</TableHead>
                <TableHead>{t("settings.evaluators.colScope")}</TableHead>
                <TableHead>{t("settings.evaluators.colTelegram")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.user_id}>
                  {/* Первая строка охватов высотой 44 px (кнопка), поэтому имя и Telegram выровнены под неё. */}
                  <TableCell className="align-top whitespace-normal break-words">
                    <div className="flex min-h-11 min-w-32 items-center">{g.user_name}</div>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <ul className="min-w-64 divide-y">
                      {g.rows.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 py-1 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <div className="break-words">{scopeLabel(r, t)}</div>
                            <div className="text-xs text-muted-foreground">{formatTashkent(r.created_at, false)}</div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 shrink-0"
                            aria-label={t("settings.evaluators.removeAria", { scope: `${g.user_name}: ${scopeLabel(r, t)}` })}
                            disabled={remove.isPending}
                            onClick={() => setRemoveTarget(r)}
                          >
                            {t("settings.evaluators.remove")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="align-top">
                    <TgCell target={{ user_id: g.user_id }} {...tg.lookup(g.user_id)} name={g.user_name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </div>
      )}

      <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.evaluators.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget ? `${removeTarget.user_name}: ${scopeLabel(removeTarget, t)}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settings.evaluators.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeTarget && remove.mutate(removeTarget.id)}>{t("settings.evaluators.remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AssignForm() {
  const t = useTranslations("kpi");
  const qc = useQueryClient();
  const terminals = useKpiTerminals();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<KpiUserOption | null>(null);
  // Пустой выбор — «все карты» / «все филиалы».
  const [cardIds, setCardIds] = useState<string[]>([]);
  const [terminalIds, setTerminalIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const searching = user === null && search.length >= MIN_SEARCH;
  const found = useQuery<KpiUserOption[], Error>({
    queryKey: qk.users(search),
    queryFn: () => kpiApi.users(search),
    enabled: searching,
    retry: shouldRetry,
  });
  const cards = useQuery<Card[], Error>({
    queryKey: qk.cards(false),
    queryFn: () => kpiApi.cards.list(false),
    retry: shouldRetry,
  });

  const cardOptions = useMemo(() => (cards.data ?? []).map((c) => ({ value: c.id, label: c.title_ru })), [cards.data]);
  const terminalOptions = useMemo(() => (terminals.data ?? []).map((term) => ({ value: term.id, label: term.name })), [terminals.data]);

  const create = useMutation({
    mutationFn: () => kpiApi.evaluators.createMany({ user_id: (user as KpiUserOption).id, card_ids: cardIds, terminal_ids: terminalIds }),
    onSuccess: ({ created, skipped }) => {
      qc.invalidateQueries({ queryKey: qk.evaluators });
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      qc.invalidateQueries({ queryKey: qk.me });
      // Ничего не создано (все назначения уже были): это не провал и не успех, поэтому нейтральный тост.
      const text = t("settings.evaluators.assignedMany", { created, skipped });
      if (created === 0) toast.info(text);
      else toast.success(text);
      setUser(null);
      setSearchText("");
      setSearch("");
      setCardIds([]);
      setTerminalIds([]);
    },
    onError: (e) => toast.error(kpiErrorText(e, t)),
  });
  const busy = create.isPending;

  return (
    <section className="space-y-3 rounded-md border p-4">
      <h2 className="text-base font-semibold">{t("settings.evaluators.assignTitle")}</h2>

      {user ? (
        <div className="flex items-center gap-2">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm">
            {user.name} ({user.login})
            <button
              type="button"
              aria-label={t("settings.evaluators.clearUserAria")}
              className="px-1 text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={() => setUser(null)}
            >
              ×
            </button>
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            aria-label={t("settings.evaluators.searchAria")}
            placeholder={t("settings.evaluators.searchPlaceholder")}
            className="h-11 w-full sm:w-96"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {found.error ? (
            <p role="alert" className="text-sm text-destructive">
              {kpiErrorText(found.error, t)}
            </p>
          ) : searching && found.isPending ? (
            <p className="text-sm text-muted-foreground">{t("settings.evaluators.searching")}</p>
          ) : searching && (found.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.evaluators.notFound")}</p>
          ) : searching ? (
            <div className="flex flex-wrap gap-2">
              {(found.data ?? []).slice(0, MAX_FOUND).map((u) => (
                <Button key={u.id} type="button" variant="outline" className="h-11" onClick={() => setUser(u)}>
                  {u.name} ({u.login})
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          options={cardOptions}
          value={cardIds}
          onChange={setCardIds}
          allLabel={t("settings.evaluators.allCards")}
          ariaLabel={t("settings.evaluators.cardAria")}
          searchLabel={t("settings.evaluators.multiSearch")}
          emptyLabel={t("settings.evaluators.multiEmpty")}
          disabled={busy}
        />
        <MultiSelect
          options={terminalOptions}
          value={terminalIds}
          onChange={setTerminalIds}
          allLabel={t("settings.evaluators.allTerminals")}
          ariaLabel={t("settings.evaluators.terminalAria")}
          searchLabel={t("settings.evaluators.multiSearch")}
          emptyLabel={t("settings.evaluators.multiEmpty")}
          disabled={busy}
        />
        <Button type="button" className="h-11" disabled={busy || user === null} onClick={() => !busy && create.mutate()}>
          {t("settings.evaluators.assign")}
        </Button>
      </div>
    </section>
  );
}
