"use client";

import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("ticketsUi.payments.action");
  return (
    <div
      role="region"
      aria-label={t("regionAria")}
      className="sticky top-2 z-10 space-y-2 rounded-lg border bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[13px]">
          <span className="font-semibold tabular-nums">{t("selected", { count })}</span>
          {totalMinor !== null && (
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {t.rich("forAmount", {
                amount: formatMinor(totalMinor),
                num: (chunks) => <span className="tabular-nums">{chunks}</span>,
              })}
            </span>
          )}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onApprove}>
            {pending === "approve" ? t("approving") : t("approve", { count })}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
            {pending === "reject" ? t("rejecting") : t("reject", { count })}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
            {t("clear")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Отдельно от панели: сбой нужно видеть и тогда, когда выбор уже опустел
// (обновление очереди могло убрать выбранные строки).
export function FailureNotice({ error }: { error: unknown }) {
  const actionError = useActionError();
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
function useActionError(): (error: unknown) => string {
  const t = useTranslations("ticketsUi.payments.action");
  const tl = useTranslations("ticketsLib");
  return (error) => {
    const e = error as ApiError;
    if (e?.status === 403) return t("forbidden", { right: PAYMENT_RIGHTS.approve });
    if (e?.status === undefined) return t("noConnection");
    return apiMessage(e, tl);
  };
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
  const t = useTranslations("ticketsUi.payments.action");
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
          {t(result.kind === "approve" ? "resultApproved" : "resultRejected", {
            done: result.done,
            skipped: result.skipped,
          })}
        </p>
        {result.skipped > 0 && (
          <p className="max-w-2xl text-[12.5px] leading-snug">
            {t("skippedNote")}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="-my-1 ml-auto size-7 shrink-0 p-0"
        aria-label={t("dismiss")}
        onClick={onDismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
