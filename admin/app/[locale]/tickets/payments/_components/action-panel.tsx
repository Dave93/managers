"use client";

import { CircleCheck, TriangleAlert, X } from "lucide-react";

import { Button } from "@admin/components/ui/buttonOrigin";
import { apiMessage, type ApiError } from "@admin/lib/tickets-api";

import { PAYMENT_RIGHTS } from "./access-panel";
import { formatMinor } from "@admin/lib/tickets-money";

export type Decision = "approve" | "reject";

// Итог последней операции. `done` — сколько заявок реально изменилось,
// `skipped` — сколько из отправленных сервер не тронул.
export type DecisionResult = { kind: Decision; done: number; skipped: number };

// Панель появляется, только когда что-то выбрано.
export function ActionPanel({
  count,
  totalMinor,
  busy,
  pending,
  onApprove,
  onReject,
  onClear,
}: {
  count: number;
  totalMinor: bigint | null;
  busy: boolean;
  pending: Decision | null;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Действия над выбранными заявками"
      className="sticky top-2 z-10 space-y-2 rounded-lg border bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px]">
          <span className="font-semibold tabular-nums">Выбрано: {count}</span>
          {totalMinor !== null && (
            <span className="text-muted-foreground">
              {" "}
              · на сумму <span className="tabular-nums">{formatMinor(totalMinor)}</span> сум
            </span>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onApprove}>
            {pending === "approve" ? "Утверждаем…" : `Утвердить ${count}`}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
            {pending === "reject" ? "Отклоняем…" : `Отклонить ${count}`}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            Снять выбор
          </Button>
        </div>
      </div>
    </div>
  );
}

// Отдельно от панели: сбой нужно видеть и тогда, когда выбор уже опустел
// (обновление очереди могло убрать выбранные строки).
export function FailureNotice({ error }: { error: unknown }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-[12.5px] leading-snug text-destructive"
    >
      {actionError(error)}
    </p>
  );
}

// Статус ответа различает причины: у 403 есть название права, у обрыва связи
// нет вовсе, и тогда неизвестно, дошёл ли запрос.
function actionError(error: unknown): string {
  const e = error as ApiError;
  if (e?.status === 403) {
    return `Сервер отказал (403): для решения по оплате нужно право ${PAYMENT_RIGHTS.approve}. Попросите администратора добавить его вашей роли.`;
  }
  if (e?.status === undefined) {
    return "Нет связи с сервером. Неизвестно, дошёл ли запрос: список обновлён, проверьте по нему, что осталось в очереди, прежде чем повторять.";
  }
  return apiMessage(e);
}

// «Пропущено» это не ошибка: сервер не тронул заявку, которой уже нет в
// очереди (её успел решить другой человек), поэтому текст пишется спокойно, а
// не красным.
export function ResultNotice({
  result,
  onDismiss,
}: {
  result: DecisionResult;
  onDismiss: () => void;
}) {
  const verb = result.kind === "approve" ? "Утверждено" : "Отклонено";
  const nothing = result.done === 0;
  const Icon = nothing ? TriangleAlert : CircleCheck;
  return (
    <div
      role="status"
      className={
        nothing
          ? "flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          : "flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-[13px] font-semibold tabular-nums">
          {verb} {result.done}, пропущено {result.skipped}
        </p>
        {result.skipped > 0 && (
          <p className="max-w-2xl text-[12.5px] leading-snug">
            Пропущенных заявок уже нет в очереди: например, по ним успел принять решение другой
            сотрудник. Это не ошибка, очередь обновлена.
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="-my-1 ml-auto size-7 shrink-0 p-0"
        aria-label="Скрыть сообщение"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
