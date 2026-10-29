"use client";

// Карточка заявки: боковая панель поверх списка.
//
// Данные приходят одним запросом GET /tickets/:id, второго запроса за именами
// нет: филиал, автор и исполнитель сервер подставляет сам, тип лежит целиком
// во вложенном поле `type`. Порядок секций: шапка, поля по схеме типа, фото
// проблемы, фото результата, акт, сумма, переписка, лента событий, действия.
//
// Что здесь сделано нарочно:
//  * любая секция переживает «дырявые» данные: тип удалён, поле убрано из схемы
//    типа после создания заявки, имя филиала не нашлось, акт не заполнен;
//  * время идёт через parseTs: строку timestamptz Postgres браузер сам не
//    разбирает;
//  * действия не закрывают панель на любую мутацию. Закрывает только успех
//    «Принять», «Вернуть» и «Отменить»; отправка комментария панель оставляет;
//  * markSeen не вызывается: это отметка «менеджер филиала увидел», офис её не
//    ставит;
//  * офис принимает работу по любому филиалу, поэтому блок действий несёт те же
//    защиты, что панель планшета: действия по правам (tickets.close для приёмки
//    и возврата, tickets.cancel для отмены), приёмка только по фото ТЕКУЩЕЙ
//    сдачи (acceptanceState из lib/tickets-branch.ts, общий с планшетом, а
//    значит они не расходятся) и подтверждение: приёмка необратима. Прежних
//    сдач (возвращённых в работу) здесь нет: возврат вложений не удаляет, и
//    отвергнутые снимки не должны выглядеть результатом.

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw, ShieldAlert, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import { Textarea } from "@components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { formatAmount } from "@admin/lib/tickets-money";
import {
  apiMessage,
  type ActorKind,
  type ApiError,
  type FieldDef,
  type PaymentStatus,
  type TicketCard,
  type TicketEventRow,
  type TicketEventType,
} from "@admin/lib/tickets-api";
import { detailValue } from "@admin/lib/tickets-details";
import { acceptanceState, type ResultColumn } from "@admin/lib/tickets-branch";
import { useMyRights, useTicketActions, useTicketCard } from "@admin/lib/use-tickets";
import { PriorityBadge, StatusBadge, parseTs } from "@admin/components/tickets/status";

import { PhotoStrip } from "./photo-strip";

// ---------------------------------------------------------------------------
// подписи и форматирование
// ---------------------------------------------------------------------------

// Подписи лежат в словаре `ticketsUi.sheet` (actor.*, event.*, payment.*);
// неизвестное значение с бэкенда показываем как есть.
export function useActorLabel(): (kind: ActorKind) => string {
  const t = useTranslations("ticketsUi.sheet");
  return (kind) => (t.has(`actor.${kind}`) ? t(`actor.${kind}`) : kind);
}

function useEventLabel(): (type: TicketEventType) => string {
  const t = useTranslations("ticketsUi.sheet");
  return (type) => (t.has(`event.${type}`) ? t(`event.${type}`) : type);
}

function usePaymentLabel(): (status: PaymentStatus) => string {
  const t = useTranslations("ticketsUi.sheet");
  return (status) => (t.has(`payment.${status}`) ? t(`payment.${status}`) : status);
}

export function fmtTs(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = parseTs(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// numeric(…) отдаёт «2.000»: лишние нули в количестве только шумят.
function fmtQty(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

const CLOSE_RIGHT = "tickets.close";
const CANCEL_RIGHT = "tickets.cancel";

// 409 у действий над заявкой значит одно: статус успели поменять до нас
// (другой сотрудник, исполнитель). Текст сервера для close говорит про
// «состояние „сдана“» и человеку ничего не объясняет, поэтому подменяем.
// 403 приходит от макроса прав английским «You don't have permissions»: вместо
// него русский текст с кодом права (как панели прав на других экранах раздела).
// Нужное право знает вызывающий, он и передаёт его вторым аргументом.
export function useActionError(): (error: unknown, right?: string) => string {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  return (error, right) => {
    const status = (error as ApiError)?.status;
    if (status === 409) return t("actionConflict");
    if (status === 403) {
      return right ? t("actionForbiddenRight", { right }) : t("actionForbidden");
    }
    return apiMessage(error, tl);
  };
}

type ResultEmptyKey = Exclude<ResultColumn, "photos">;

// ---------------------------------------------------------------------------
// поля по схеме типа
// ---------------------------------------------------------------------------

type FieldRow = { key: string; label: string; value: string; removed: boolean };

export function buildFieldRows(card: TicketCard): { rows: FieldRow[]; schemaKnown: boolean } {
  const schemaKnown = Boolean(card.type);
  const schema: FieldDef[] = Array.isArray(card.type?.fields_schema) ? card.type!.fields_schema : [];
  const details: Record<string, unknown> =
    card.details && typeof card.details === "object" ? card.details : {};

  const rows: FieldRow[] = schema.map((f) => {
    const raw = detailValue(details, f.key);
    const text = raw === undefined || raw === null ? "" : String(raw);
    const option = f.options?.find((o) => o.value === text);
    return {
      key: f.key,
      label: f.label_ru || f.key,
      value: text === "" ? "—" : (option?.label_ru ?? text),
      removed: false,
    };
  });

  // Ключи, которых нет в схеме: тип правили уже после создания заявки. Если
  // сам тип недоступен, «поле удалено из типа» было бы враньём, и пометки нет.
  for (const key of Object.keys(details)) {
    if (schema.some((f) => f.key === key)) continue;
    rows.push({ key, label: key, value: String(detailValue(details, key) ?? "—"), removed: schemaKnown });
  }
  return { rows, schemaKnown };
}

// ---------------------------------------------------------------------------
// секции
// ---------------------------------------------------------------------------

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function FieldsSection({ card }: { card: TicketCard }) {
  const t = useTranslations("ticketsUi.sheet");
  const { rows, schemaKnown } = buildFieldRows(card);
  const description = card.description?.trim();
  return (
    <Section title={t("fieldsTitle")}>
      {!schemaKnown && (
        <p className="text-[12px] text-muted-foreground">
          {t("schemaUnknown")}
        </p>
      )}
      {rows.length === 0 && !description ? (
        <Empty>{t("noFields")}</Empty>
      ) : (
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="break-words">
                {r.value}
                {r.removed && (
                  <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-400">
                    {t("fieldRemoved")}
                  </span>
                )}
              </dd>
            </div>
          ))}
          {description && (
            <div className="contents">
              <dt className="text-muted-foreground">{t("description")}</dt>
              <dd className="whitespace-pre-wrap break-words">{description}</dd>
            </div>
          )}
        </dl>
      )}
    </Section>
  );
}

export function ActSection({ card }: { card: TicketCard }) {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  const items = card.work_items ?? [];
  return (
    <Section title={t("actTitle")}>
      {items.length === 0 ? (
        <Empty>{t("actEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-1.5 font-medium">№</th>
                <th className="px-3 py-1.5 font-medium">{t("actWork")}</th>
                <th className="px-3 py-1.5 text-right font-medium">{t("actQty")}</th>
                <th className="px-3 py-1.5 text-right font-medium">{t("actAmount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((w, i) => (
                <tr key={w.id}>
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{w.position ?? i + 1}</td>
                  <td className="px-3 py-1.5 break-words">{w.title}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    {fmtQty(w.qty)}
                    {w.unit ? ` ${w.unit}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatAmount(w.amount, tl)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/20 font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right">
                  {t("actTotal")}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  {formatAmount(card.work_total_amount, tl)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

export function PaymentSection({ card }: { card: TicketCard }) {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  const paymentLabel = usePaymentLabel();
  // Сумма появляется вместе с актом. До него payment_status всё равно
  // «pending», и подпись «на утверждении офиса» у заявки без суммы лгала бы.
  if (card.work_total_amount === null || card.work_total_amount === undefined) return null;
  const status = card.payment_status;
  return (
    <Section title={t("paymentTitle")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold tabular-nums">{formatAmount(card.work_total_amount, tl)}</span>
        <span className="text-muted-foreground">{paymentLabel(status)}</span>
        {status !== "pending" && card.payment_approved_at && (
          <span className="text-[12px] text-muted-foreground">{fmtTs(card.payment_approved_at)}</span>
        )}
      </div>
      {status === "rejected" && card.payment_comment && (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{card.payment_comment}</p>
      )}
    </Section>
  );
}

function ConversationSection({
  card,
  draft,
  setDraft,
  onSend,
  sending,
  error,
}: {
  card: TicketCard;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  error: unknown;
}) {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  const actorLabel = useActorLabel();
  const comments = card.comments ?? [];
  return (
    <Section title={t("conversationTitle")}>
      {comments.length === 0 ? (
        <Empty>{t("noComments")}</Empty>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-muted-foreground">
                <span className="font-medium text-foreground">{actorLabel(c.author_kind)}</span>
                <span className="tabular-nums">{fmtTs(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("commentPlaceholder")}
          aria-label={t("commentAria")}
          rows={2}
          disabled={sending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onSend} disabled={sending || draft.trim() === ""}>
            {sending ? t("sending") : t("send")}
          </Button>
          {error ? (
            <span role="alert" className="text-[12.5px] text-destructive">
              {apiMessage(error, tl)}
            </span>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

export function EventsSection({ events }: { events: TicketEventRow[] }) {
  const t = useTranslations("ticketsUi.sheet");
  const actorLabel = useActorLabel();
  const eventLabel = useEventLabel();
  return (
    <Section title={t("eventsTitle")}>
      {events.length === 0 ? (
        <Empty>{t("noEvents")}</Empty>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {events.map((e) => {
            const note = typeof e.payload?.comment === "string" ? e.payload.comment : null;
            return (
              <li key={e.id}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{eventLabel(e.type)}</span>
                  <span className="text-[11.5px] text-muted-foreground">{actorLabel(e.actor_kind)}</span>
                  <span className="text-[11.5px] tabular-nums text-muted-foreground">{fmtTs(e.created_at)}</span>
                </div>
                {note && (
                  <p className="whitespace-pre-wrap break-words text-[12.5px] text-muted-foreground">{note}</p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// карточка
// ---------------------------------------------------------------------------

function CardView({ card, onClose }: { card: TicketCard; onClose: () => void }) {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  const actionError = useActionError();
  const qc = useQueryClient();
  // Без onDone: хук вызывает его после ЛЮБОЙ мутации, в том числе после
  // комментария, и отправка сообщения закрыла бы панель. Закрытие передаётся
  // в mutate() только для трёх действий над статусом.
  const actions = useTicketActions();
  const [draft, setDraft] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const rights = useMyRights();
  const canClose = rights.has(CLOSE_RIGHT);
  const canCancel = rights.has(CANCEL_RIGHT);
  // Защёлка от двойного нажатия: isPending мутации меняется только на
  // следующем рендере. После успеха остаётся поднятой (панель закрывается),
  // после сбоя снимается.
  const latch = useRef(false);

  const statusMutations = [actions.close, actions.reopen, actions.cancel];
  const busy = statusMutations.some((m) => m.isPending);
  // Какое право нужно отказавшему действию: по нему 403 называет право.
  const failed = (
    [
      [actions.close, CLOSE_RIGHT],
      [actions.reopen, CLOSE_RIGHT],
      [actions.cancel, CANCEL_RIGHT],
    ] as const
  ).find(([m]) => m.isError);

  const run = (start: (opts: { onSuccess: () => void; onError: (e: Error) => void }) => void) => {
    if (latch.current) return;
    latch.current = true;
    statusMutations.forEach((m) => m.reset());
    start({
      onSuccess: onClose,
      // При 409 карточка на экране устарела: обновляем её, чтобы кнопки
      // соответствовали настоящему статусу.
      onError: (e) => {
        latch.current = false;
        if ((e as ApiError).status === 409) qc.invalidateQueries({ queryKey: ["tickets"] });
      },
    });
  };

  const typeName = card.type?.name_ru ?? t("typeDeleted");
  const terminal = card.terminal_name ?? t("branchNotFound");
  const executor = card.assigned_executor_id
    ? (card.executor_name ?? t("executorDeleted"))
    : t("notAssigned");
  const problem = (card.attachments ?? []).filter((a) => a.phase === "problem");
  // Фото и кнопки приёмки решает та же функция, что у планшета: только снимки
  // текущей сдачи (возврат в работу вложений не удаляет).
  const accept = acceptanceState(card);
  const result = accept.result;
  const resultEmpty = t(`resultEmpty.${(accept.column === "photos" ? "none" : accept.column) as ResultEmptyKey}`);
  const hasAmount = card.work_total_amount !== null && card.work_total_amount !== undefined;

  return (
    <>
      <SheetHeader className="shrink-0 space-y-1.5 border-b px-5 py-4 pr-12 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="font-mono text-base tabular-nums">{card.number}</SheetTitle>
          <StatusBadge status={card.status} />
          <PriorityBadge priority={card.priority} />
        </div>
        <SheetDescription className="text-[13px] text-foreground">
          {typeName} · {terminal}
        </SheetDescription>
        <p className="text-[12px] leading-snug text-muted-foreground">
          {t("headerMeta", {
            date: fmtTs(card.created_at),
            author: card.author_name ?? t("authorUnknown"),
            executor,
          })}
          {card.reopen_count > 0 ? ` ${t("reopenedCount", { count: card.reopen_count })}` : ""}
        </p>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <FieldsSection card={card} />
        <PhotoStrip title={t("photosProblem")} items={problem} empty={t("photosProblemEmpty")} />
        {/* Решает колонка, как на планшете: у заявки в работе снимки новее
            последнего возврата полосой не показываются, там заглушка. */}
        <PhotoStrip
          title={t("photosResult")}
          items={accept.column === "photos" ? result : []}
          empty={resultEmpty}
        />
        <ActSection card={card} />
        <PaymentSection card={card} />
        <ConversationSection
          card={card}
          draft={draft}
          setDraft={setDraft}
          sending={actions.comment.isPending}
          error={actions.comment.error}
          onSend={() => {
            const body = draft.trim();
            if (!body) return;
            actions.comment.mutate({ id: card.id, body }, { onSuccess: () => setDraft("") });
          }}
        />
        <EventsSection events={card.events ?? []} />
      </div>

      <div className="shrink-0 space-y-3 border-t bg-background px-5 py-3">
        {!rights.settled ? (
          <Skeleton className="h-9 w-48" />
        ) : (
          <>
            {card.status === "done" && canClose && (
              <div className="space-y-2">
                {accept.ret && (
                  <Textarea
                    value={returnComment}
                    onChange={(e) => setReturnComment(e.target.value)}
                    placeholder={t("returnPlaceholder")}
                    aria-label={t("returnAria")}
                    rows={2}
                    disabled={busy}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {accept.accept && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button disabled={busy}>{actions.close.isPending ? t("accepting") : t("accept")}</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("acceptTitle", { number: card.number })}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("acceptDesc1")}
                            {hasAmount
                              ? ` ${t("acceptDescAmount", { amount: formatAmount(card.work_total_amount, tl) })}`
                              : ""}{" "}
                            {t("acceptDesc2")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("acceptCancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => run((o) => actions.close.mutate(card.id, o))}>
                            {t("accept")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy || returnComment.trim() === ""}
                    onClick={() =>
                      run((o) => actions.reopen.mutate({ id: card.id, comment: returnComment.trim() }, o))
                    }
                  >
                    {actions.reopen.isPending ? t("returning") : t("returnToWork")}
                  </Button>
                </div>
                {!accept.accept && (
                  <p className="text-[12.5px] leading-snug text-muted-foreground">
                    {t("acceptNoPhotos")}
                  </p>
                )}
              </div>
            )}

            {card.status === "done" && !canClose && (
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                {t.rich("noCloseRight", {
                  right: CLOSE_RIGHT,
                  code: (chunks) => (
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{chunks}</code>
                  ),
                })}
              </p>
            )}

            {(card.status === "new" || card.status === "in_progress") && canCancel && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    {actions.cancel.isPending ? t("cancelling") : t("cancel")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("cancelTitle", { number: card.number })}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("cancelDesc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={t("cancelReasonPlaceholder")}
                    aria-label={t("cancelReasonAria")}
                    rows={2}
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancelKeep")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        const comment = cancelReason.trim();
                        run((o) =>
                          actions.cancel.mutate({ id: card.id, ...(comment ? { comment } : {}) }, o)
                        );
                      }}
                    >
                      {t("cancelConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {(card.status === "new" || card.status === "in_progress") && !canCancel && (
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                {t.rich("noCancelRight", {
                  right: CANCEL_RIGHT,
                  code: (chunks) => (
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{chunks}</code>
                  ),
                })}
              </p>
            )}

            {(card.status === "closed" || card.status === "cancelled") && (
              <p className="text-sm text-muted-foreground">
                {card.status === "closed" ? t("closedNoActions") : t("cancelledNoActions")}
              </p>
            )}
          </>
        )}

        {failed ? (
          <p role="alert" className="text-[12.5px] leading-snug text-destructive">
            {actionError(failed[0].error, failed[1])}
          </p>
        ) : null}
      </div>
    </>
  );
}

// Загрузка, ошибка и «нет такой заявки» различимы и ни одна не вечная.
export function Notice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div role="alert" className="flex items-start gap-3 px-5 py-6">
      {icon}
      <div className="min-w-0 space-y-2.5">
        <p className="text-[14px] font-semibold leading-tight">{title}</p>
        {children}
      </div>
    </div>
  );
}

function TicketBody({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const t = useTranslations("ticketsUi.sheet");
  const tl = useTranslations("ticketsLib");
  const { data: card, isPending, isError, error, isFetching, refetch } = useTicketCard(ticketId);

  if (card) return <CardView card={card} onClose={onClose} />;

  const apiError = error as ApiError | null;
  const status = apiError?.status;
  return (
    <>
      <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <SheetTitle className="text-base">{t("ticket")}</SheetTitle>
        <SheetDescription className="sr-only">{t("ticketCard")}</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isPending}>
        {isPending ? (
          <div className="space-y-4 px-5 py-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError && status === 404 ? (
          <Notice
            icon={<TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />}
            title={t("notFoundTitle")}
          >
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              {t("notFoundBody")}
            </p>
          </Notice>
        ) : isError && status === 403 ? (
          <Notice
            icon={<ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />}
            title={t("forbiddenTitle")}
          >
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              {t.rich("forbiddenBody", {
                right: "tickets.list",
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{chunks}</code>
                ),
              })}
            </p>
          </Notice>
        ) : (
          <Notice
            icon={<TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />}
            title={status === undefined ? t("noConnection") : t("loadFailed")}
          >
            <p className="break-words text-[12.5px] leading-snug text-muted-foreground">
              {apiError ? apiMessage(apiError, tl) : t("unknownError")}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RotateCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
              {isFetching ? t("retrying") : t("retry")}
            </Button>
          </Notice>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// панель
// ---------------------------------------------------------------------------

// Пока панель закрывается, ticketId уже null, но Radix ещё 300 мс рисует
// уходящую панель: без запомненного id она выехала бы пустой. А «эпоха»
// растёт при каждом новом открытии, чтобы повторное открытие той же заявки
// не принесло старый черновик и старую ошибку действия.
export function useSheetSession(ticketId: string | null) {
  const [s, setS] = useState({ prev: ticketId, shown: ticketId, epoch: 0 });
  if (ticketId !== s.prev) {
    setS({
      prev: ticketId,
      shown: ticketId ?? s.shown,
      epoch: ticketId !== null && s.prev === null ? s.epoch + 1 : s.epoch,
    });
  }
  return { shown: s.shown, epoch: s.epoch };
}

export function TicketSheet({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const { shown, epoch } = useSheetSession(ticketId);
  // У панели нет триггера (её открывает строка таблицы), и Radix по умолчанию
  // не возвращает фокус никуда: с клавиатуры человек терял бы место в списке.
  // Запоминаем, что было в фокусе при открытии, и возвращаем туда.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Sheet open={ticketId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-2xl"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        {shown !== null && <TicketBody key={`${shown}:${epoch}`} ticketId={shown} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}
