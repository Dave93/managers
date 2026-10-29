"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type Card, type EmployeeRow, type EmployeesQuery } from "@admin/lib/kpi-api";
import { kpiErrorText, loadErrors, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL, employeeName } from "@admin/lib/kpi/filters";
import {
  assignBody,
  assignValue,
  cardAssignLabel,
  externalIdIssue,
  externalIdValue,
  type AssignValue,
} from "@admin/lib/kpi/settings";
import { StaleNote } from "../../_components/stale-note";
import { qk, useKpiMe, useKpiTerminals } from "../../_components/use-kpi";
import { TgCell } from "./tg-cell";
import { useTgBindings } from "./use-tg-bindings";

const MIN_SEARCH = 2;

export function EmployeesTab() {
  const t = useTranslations("kpi");
  const me = useKpiMe();
  const terminals = useKpiTerminals();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [terminal, setTerminal] = useState(ALL);
  const [target, setTarget] = useState<EmployeeRow | null>(null);
  // Табельный номер правится в одной строке за раз.
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const period = me.data?.current_period;
  const terminalId = terminal === ALL ? undefined : terminal;
  const ready = search.length >= MIN_SEARCH || terminalId !== undefined;
  const query: EmployeesQuery | null =
    period && ready
      ? {
          period,
          ...(search.length >= MIN_SEARCH ? { search } : {}),
          ...(terminalId ? { terminal_id: terminalId } : {}),
          include_uncarded: true,
        }
      : null;

  const list = useQuery<EmployeeRow[], Error>({
    queryKey: query ? qk.employees(query) : [...qk.employeesAll, "idle"],
    queryFn: () => kpiApi.employees.list(query as EmployeesQuery),
    enabled: query !== null,
    retry: shouldRetry,
  });
  const rows = list.data ?? [];
  const tg = useTgBindings("employee", rows.map((r) => r.id));
  const tgLoad = loadErrors({ error: tg.error, data: tg.data });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("settings.employees.hint")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("settings.employees.searchAria")}
          placeholder={t("settings.employees.searchPlaceholder")}
          className="h-11 w-full sm:w-64"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Select value={terminal} onValueChange={setTerminal}>
          <SelectTrigger className="h-11 w-full sm:w-60" aria-label={t("settings.employees.terminalAria")}>
            <SelectValue placeholder={t("settings.employees.terminalPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("settings.employees.allTerminals")}</SelectItem>
            {(terminals.data ?? []).map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {me.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(me.error, t)}
        </p>
      ) : !ready ? (
        <p className="text-sm text-muted-foreground">{t("settings.employees.promptSearch")}</p>
      ) : list.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error, t)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">{t("settings.employees.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.employees.empty")}</p>
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
                <TableHead>{t("settings.employees.colName")}</TableHead>
                <TableHead>{t("settings.employees.colTerminal")}</TableHead>
                <TableHead>{t("settings.employees.colRole")}</TableHead>
                <TableHead>{t("settings.employees.colCard")}</TableHead>
                <TableHead>{t("settings.employees.colExternalId")}</TableHead>
                <TableHead>{t("settings.employees.colTelegram")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{employeeName(r)}</TableCell>
                  <TableCell>{r.terminal_name ?? "—"}</TableCell>
                  <TableCell>{r.staff_role_name ?? "—"}</TableCell>
                  <TableCell>{cardAssignLabel(r, t)}</TableCell>
                  <TableCell>
                    <ExternalIdCell
                      row={r}
                      editing={editingId === r.id}
                      onEdit={() => setEditingId(r.id)}
                      onClose={() => setEditingId((id) => (id === r.id ? null : id))}
                    />
                  </TableCell>
                  <TableCell>
                    <TgCell target={{ employee_id: r.id }} {...tg.lookup(r.id)} name={employeeName(r)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" className="h-11" onClick={() => setTarget(r)}>
                      {t("settings.employees.cardButton")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </div>
      )}

      <AssignDialog row={target} onClose={() => setTarget(null)} />
    </div>
  );
}

function ExternalIdCell({
  row,
  editing,
  onEdit,
  onClose,
}: {
  row: EmployeeRow;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("kpi");
  const qc = useQueryClient();
  const [text, setText] = useState(row.external_id ?? "");
  const issue = externalIdIssue(text, t);

  const save = useMutation({
    mutationFn: (value: string | null) => kpiApi.employees.setExternalId(row.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      toast.success(t("settings.employees.externalIdSaved"));
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e, t)),
  });

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span>{row.external_id ?? "—"}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t("settings.employees.editExternalIdAria")}
          onClick={() => {
            setText(row.external_id ?? "");
            onEdit();
          }}
        >
          <Pencil className="size-4" />
        </Button>
      </span>
    );
  }

  const submit = () => {
    if (save.isPending || issue) return;
    const value = externalIdValue(text);
    if (value === row.external_id) return onClose();
    save.mutate(value);
  };

  return (
    <div className="min-w-48 space-y-1">
      <Input
        autoFocus
        maxLength={100}
        aria-label={t("settings.employees.externalIdAria")}
        className="h-11"
        value={text}
        disabled={save.isPending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && !save.isPending) {
            onClose();
          }
        }}
      />
      {issue && <p className="text-xs text-destructive">{issue}</p>}
      <div className="flex gap-2">
        <Button type="button" className="h-11" disabled={save.isPending || issue !== null} onClick={submit}>
          {t("settings.employees.save")}
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={save.isPending} onClick={onClose}>
          {t("settings.employees.cancel")}
        </Button>
      </div>
    </div>
  );
}

function AssignDialog({ row, onClose }: { row: EmployeeRow | null; onClose: () => void }) {
  const t = useTranslations("kpi");
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {row ? (
          <AssignBody key={row.id} row={row} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">{t("settings.employees.assignTitle")}</DialogTitle>
            <DialogDescription className="sr-only">{t("settings.employees.assignTitle")}</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignBody({ row, onClose, onPending }: { row: EmployeeRow; onClose: () => void; onPending: (p: boolean) => void }) {
  const t = useTranslations("kpi");
  const qc = useQueryClient();
  const cards = useQuery<Card[], Error>({
    queryKey: qk.cards(false),
    queryFn: () => kpiApi.cards.list(false),
    retry: shouldRetry,
  });
  const [value, setValue] = useState<AssignValue>(() => assignValue(row));
  const [comment, setComment] = useState("");

  // Назначенная вручную карта могла быть отключена: оставляем её в списке, иначе Select окажется пустым.
  const options = useMemo(() => {
    const list = (cards.data ?? []).map((c) => ({ id: c.id, title: c.title_ru }));
    if (row.card_source === "override" && row.card && !list.some((c) => c.id === row.card!.id)) {
      list.push({ id: row.card.id, title: row.card.title_ru });
    }
    return list;
  }, [cards.data, row.card, row.card_source]);

  const save = useMutation({
    mutationFn: () => kpiApi.employees.setCard(row.id, assignBody(value), comment.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      qc.invalidateQueries({ queryKey: qk.formAll });
      toast.success(t("settings.employees.cardSaved"));
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e, t)),
  });

  const busy = save.isPending;
  useEffect(() => {
    onPending(busy);
    return () => onPending(false);
  }, [busy, onPending]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("settings.employees.assignTitle")}</DialogTitle>
        <DialogDescription>{[employeeName(row), row.terminal_name].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>

      {cards.error && (
        <p role="alert" className="text-sm text-destructive">
          {kpiErrorText(cards.error, t)}
        </p>
      )}

      <Select value={value} disabled={busy} onValueChange={setValue}>
        <SelectTrigger className="h-11 w-full" aria-label={t("settings.employees.cardAria")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t("settings.employees.optionAuto")}</SelectItem>
          <SelectItem value="none">{t("settings.employees.optionNone")}</SelectItem>
          {options.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Textarea
        rows={3}
        value={comment}
        disabled={busy}
        onChange={(e) => setComment(e.target.value)}
        aria-label={t("settings.employees.commentAria")}
        placeholder={t("settings.employees.commentPlaceholder")}
      />

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
          {t("settings.employees.cancel")}
        </Button>
        <Button type="button" className="h-11" disabled={busy || cards.isPending} onClick={() => !busy && save.mutate()}>
          {t("settings.employees.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
