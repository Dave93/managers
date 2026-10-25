"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Textarea } from "@admin/components/ui/textarea";
import { kpiApi, type Card, type EmployeeRow, type EmployeesQuery } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { ALL, employeeName } from "@admin/lib/kpi/filters";
import {
  assignBody,
  assignValue,
  cardAssignLabel,
  externalIdIssue,
  externalIdValue,
  type AssignValue,
} from "@admin/lib/kpi/settings";
import { qk, useKpiMe, useKpiTerminals } from "../../_components/use-kpi";

const MIN_SEARCH = 2;

export function EmployeesTab() {
  const me = useKpiMe();
  const terminals = useKpiTerminals();
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [terminal, setTerminal] = useState(ALL);
  const [target, setTarget] = useState<EmployeeRow | null>(null);
  // Табельный номер правится в одной строке за раз.
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Табельный номер нужен для загрузки Workly: строки файла сопоставляются с сотрудниками по нему
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Поиск сотрудника"
          placeholder="Фамилия или имя"
          className="h-11 w-full sm:w-64"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <Select value={terminal} onValueChange={setTerminal}>
          <SelectTrigger className="h-11 w-full sm:w-60" aria-label="Филиал">
            <SelectValue placeholder="Филиал" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все филиалы</SelectItem>
            {(terminals.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {me.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(me.error)}
        </p>
      ) : !ready ? (
        <p className="text-sm text-muted-foreground">Найдите сотрудника по фамилии или выберите филиал</p>
      ) : list.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Никого не нашли</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Должность</TableHead>
                <TableHead>Карта</TableHead>
                <TableHead>Табельный номер</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{employeeName(r)}</TableCell>
                  <TableCell>{r.terminal_name ?? "—"}</TableCell>
                  <TableCell>{r.staff_role_name ?? "—"}</TableCell>
                  <TableCell>{cardAssignLabel(r)}</TableCell>
                  <TableCell>
                    <ExternalIdCell
                      row={r}
                      editing={editingId === r.id}
                      onEdit={() => setEditingId(r.id)}
                      onClose={() => setEditingId((id) => (id === r.id ? null : id))}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="outline" className="h-11" onClick={() => setTarget(r)}>
                      Карта…
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
  const qc = useQueryClient();
  const [text, setText] = useState(row.external_id ?? "");
  const issue = externalIdIssue(text);

  const save = useMutation({
    mutationFn: (value: string | null) => kpiApi.employees.setExternalId(row.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.employeesAll });
      toast.success("Табельный номер сохранён");
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
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
          aria-label="Изменить табельный номер"
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
        aria-label="Табельный номер"
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
          Сохранить
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={save.isPending} onClick={onClose}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function AssignDialog({ row, onClose }: { row: EmployeeRow | null; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {row ? (
          <AssignBody key={row.id} row={row} onClose={onClose} onPending={setPending} />
        ) : (
          <>
            <DialogTitle className="sr-only">Карта сотрудника</DialogTitle>
            <DialogDescription className="sr-only">Карта сотрудника</DialogDescription>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignBody({ row, onClose, onPending }: { row: EmployeeRow; onClose: () => void; onPending: (p: boolean) => void }) {
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
      toast.success("Карта сохранена");
      onClose();
    },
    onError: (e) => toast.error(kpiErrorText(e)),
  });

  const busy = save.isPending;
  useEffect(() => {
    onPending(busy);
    return () => onPending(false);
  }, [busy, onPending]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Карта сотрудника</DialogTitle>
        <DialogDescription>{[employeeName(row), row.terminal_name].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>

      {cards.error && (
        <p role="alert" className="text-sm text-destructive">
          {kpiErrorText(cards.error)}
        </p>
      )}

      <Select value={value} disabled={busy} onValueChange={setValue}>
        <SelectTrigger className="h-11 w-full" aria-label="Карта">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Авто (по должности)</SelectItem>
          <SelectItem value="none">Не оценивается</SelectItem>
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
        aria-label="Комментарий"
        placeholder="Комментарий (необязательно)"
      />

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onClose}>
          Отмена
        </Button>
        <Button type="button" className="h-11" disabled={busy || cards.isPending} onClick={() => !busy && save.mutate()}>
          Сохранить
        </Button>
      </DialogFooter>
    </>
  );
}
