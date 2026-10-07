"use client";

// Очередь «К оплате»: экран финансиста. Закрытые заявки с актом, по которым
// нужно решить, платить ли. Строка раскрывается в акт и фото результата, а
// пачка, которую закрывают раз в неделю, утверждается галочками.
//
// Два права: tickets.payment.approve (решение) и tickets.list (чтение строк).
// Если сессии не хватает любого, вместо очереди панель с названием права, и
// запрос списка даже не уходит. Отказ сервера 403 на чтение (устаревший кэш
// прав) обрабатывает таблица.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@admin/utils/eden";
import type { TicketRow } from "@admin/lib/tickets-api";

import { AccessPanel, PAYMENT_RIGHTS } from "./_components/access-panel";
import {
  ActionPanel,
  FailureNotice,
  ResultNotice,
  type Decision,
  type DecisionResult,
} from "./_components/action-panel";
import { ConfirmDialog, type Confirmation } from "./_components/confirm-dialog";
import { sumMinor } from "./_components/money";
import { usePaymentActions, usePaymentQueue } from "./_components/use-payments";
import { buildPaymentColumns, type SelectAllState } from "./columns";
import { DataTable } from "./data-table";

const REQUIRED = [PAYMENT_RIGHTS.approve, PAYMENT_RIGHTS.list];
const DEFAULT_PAGE_SIZE = 100;
const NO_ROWS: TicketRow[] = [];

export default function PaymentsPage() {
  // Тот же ключ, что у CanAccess и layout: один запрос на всё приложение.
  const perms = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
    retry: false,
  });
  const granted = (perms.data as { permissions?: string[] } | null | undefined)?.permissions;
  const permsKnown = Array.isArray(granted);
  const missing = permsKnown ? REQUIRED.filter((p) => !granted.includes(p)) : [];
  // Пока запрос прав не завершился, очередь не запрашиваем. Завершившись чем
  // угодно, кроме рабочего списка, он передаёт решение серверу: 403 на чтении
  // покажет таблица, 401 и 5xx она покажет панелью ошибки с «Повторить».
  // Недостаточно проверять isError: Eden не бросает на не-2xx, а отдаёт
  // {data: null, error}, и запрос прав на истёкшей сессии «успешен» со
  // значением null. Без isSuccess очередь в этом случае не включилась бы никогда
  // и страница осталась бы скелетом без текста и без кнопки.
  const queueEnabled = missing.length === 0 && (permsKnown || perms.isError || perms.isSuccess);

  const [{ pageIndex, pageSize }, setPaging] = useState({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });
  const queue = usePaymentQueue(pageSize, pageIndex * pageSize, queueEnabled);
  const rows = queue.data?.data ?? NO_ROWS;
  const total = queue.data?.total ?? 0;
  const qc = useQueryClient();

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const actions = usePaymentActions();
  const busy = actions.approve.isPending || actions.reject.isPending;
  const pending: Decision | null = actions.approve.isPending
    ? "approve"
    : actions.reject.isPending
      ? "reject"
      : null;
  const failure = actions.approve.error ?? actions.reject.error;

  // Выбор живёт по id заявки. Строки, которых больше нет в очереди (решил
  // другой человек, ушли на другую страницу), из выбора выпадают.
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  // Решили последнюю заявку страницы, не последней: страница опустела, а
  // очередь нет. Возвращаемся на последнюю непустую; если пуста вся очередь
  // (total = 0), то на первую, иначе осталось бы «стр. 3 из 1».
  useEffect(() => {
    if (queue.data && rows.length === 0 && pageIndex > 0) {
      setPaging((p) => ({ ...p, pageIndex: Math.max(Math.ceil(total / p.pageSize) - 1, 0) }));
    }
  }, [queue.data, rows.length, total, pageIndex]);

  const selectAll: SelectAllState =
    selectedRows.length === 0 ? "none" : selectedRows.length === rows.length ? "all" : "some";
  const selectedTotal = useMemo(
    () => sumMinor(selectedRows.map((r) => r.work_total_amount)),
    [selectedRows]
  );

  const columns = useMemo(
    () =>
      buildPaymentColumns({
        selected,
        expanded,
        selectAll,
        busy,
        onToggle: (id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
          }),
        onToggleAll: () => setSelected(selectAll === "all" ? new Set() : new Set(rows.map((r) => r.id))),
        onExpand: (id) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
          }),
      }),
    [selected, expanded, selectAll, busy, rows]
  );

  const changePage = (i: number) => {
    setSelected(new Set());
    setPaging((p) => ({ ...p, pageIndex: Math.max(i, 0) }));
  };
  const changeSize = (s: number) => {
    setSelected(new Set());
    setPaging({ pageIndex: 0, pageSize: s });
  };

  const open = (kind: Decision) =>
    setConfirmation({ kind, ids: selectedRows.map((r) => r.id), totalMinor: selectedTotal });

  const run = (c: Confirmation) => {
    setConfirmation(null);
    setResult(null);
    actions.approve.reset();
    actions.reject.reset();
    const onSuccess = (done: number, skipped: number) => {
      setResult({ kind: c.kind, done, skipped });
      setSelected(new Set());
      if (c.kind === "reject") setRejectComment("");
    };
    // Любой сбой обновляет очередь: при обрыве связи неизвестно, дошёл ли
    // запрос, и устаревший список хуже свежего.
    const onError = () => qc.invalidateQueries({ queryKey: ["tickets", "payments"] });
    if (c.kind === "approve") {
      actions.approve.mutate(c.ids, { onSuccess: (r) => onSuccess(r.approved, r.skipped), onError });
    } else {
      actions.reject.mutate(
        { ids: c.ids, comment: rejectComment.trim() },
        { onSuccess: (r) => onSuccess(r.rejected, r.skipped), onError }
      );
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">К оплате</h1>
        <p className="text-[12px] text-muted-foreground">
          Закрытые заявки с актом, по которым нужно решить: платить или нет. Раскройте строку, чтобы
          увидеть акт и фото результата, отметьте нужные и утвердите пачку одним нажатием.
        </p>
      </div>

      {missing.length > 0 ? (
        <AccessPanel missing={missing} />
      ) : (
        <>
          {result && <ResultNotice result={result} onDismiss={() => setResult(null)} />}
          {failure ? <FailureNotice error={failure} /> : null}
          {selectedRows.length > 0 && (
            <ActionPanel
              count={selectedRows.length}
              totalMinor={selectedTotal}
              busy={busy}
              pending={pending}
              onApprove={() => open("approve")}
              onReject={() => open("reject")}
              onClear={() => setSelected(new Set())}
            />
          )}
          <DataTable
            columns={columns}
            queue={queue}
            rows={rows}
            expanded={expanded}
            pageIndex={pageIndex}
            pageSize={pageSize}
            onPageIndex={changePage}
            onPageSize={changeSize}
            onRetry={() => qc.invalidateQueries({ queryKey: ["tickets", "payments"] })}
          />
          <ConfirmDialog
            confirmation={confirmation}
            comment={rejectComment}
            onComment={setRejectComment}
            onCancel={() => setConfirmation(null)}
            onConfirm={run}
          />
        </>
      )}
    </div>
  );
}
