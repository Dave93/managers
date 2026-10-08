"use client";

// Панель приёмки на планшете: «было / стало» и две кнопки. Слева фото проблемы,
// справа фото результата, между ними акт выполненных работ и итог.
//
// Что здесь сделано нарочно:
//  * Пункт 3 из Review Focus. Если фото результата нет (исполнитель ещё не
//    сдал работу), правая колонка так и говорит, кнопки «Принять работу» нет:
//    принимать нечего. Панель при этом открыта и показывает левую половину.
//    Правила вынесены в lib/tickets-branch.ts (resultColumn, canAccept) и
//    покрыты тестами.
//  * «Филиал посмотрел» (markSeen) утверждается ЗДЕСЬ и только здесь, и только
//    когда карточка реально загружена в открытой панели. Прокрутка списка, ссылка
//    ?created= и неудачная загрузка карточки отметку не ставят. Сбой markSeen
//    молчит: точка останется гореть, а панель не сломается.
//  * Своё же действие не должно зажигать точку. Комментарий, приёмка и возврат
//    пишут события новее отметки, поэтому отметка ставится внутри самого
//    действия (usePanelActions), и это переживает закрытие панели.
//  * Фото результата это только снимки текущей сдачи (позже последнего
//    возврата в работу): возврат вложений не удаляет.
//  * Статусы, подписи, акт и текст 409 общие с карточкой офиса
//    (tickets/_components/ticket-sheet.tsx): здесь они импортируются, а не
//    переписываются.
//  * Сумма видна и не редактируется; подпись «на утверждении офиса» даёт
//    PaymentSection по payment_status.
//  * Приёмка необратима (заявка закрывается, исполнителю уходит сообщение, сумма
//    попадает в очередь оплаты), а на сенсорном экране промахнуться проще, чем
//    мышью, поэтому «Принять работу» спрашивает подтверждение.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Hourglass, RotateCw, ShieldAlert, TriangleAlert } from "lucide-react";

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
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@components/ui/sheet";
import { formatAmount } from "@admin/lib/tickets-money";
import {
  addComment,
  apiMessage,
  closeTicket,
  markSeen,
  reopenTicket,
  type ApiError,
  type TicketCard,
} from "@admin/lib/tickets-api";
import {
  canAccept,
  canReturn,
  cardHasUnread,
  currentResultPhotos,
  lastEventOf,
  resultColumn,
  type ResultColumn,
} from "@admin/lib/tickets-branch";
import { useTicketCard } from "@admin/lib/use-tickets";
import { PriorityBadge, StatusBadge, WaitingFor } from "@admin/components/tickets/status";

import { PhotoStrip } from "../../tickets/_components/photo-strip";
import {
  ActSection,
  Empty,
  EventsSection,
  FieldsSection,
  Notice,
  PaymentSection,
  Section,
  actionError,
  actorLabel,
  fmtTs,
  useSheetSession,
} from "../../tickets/_components/ticket-sheet";

// ---------------------------------------------------------------------------
// «филиал посмотрел»
// ---------------------------------------------------------------------------

// Без await и без исключений наружу: отметка не должна влиять на панель. После
// успеха список и карточка перечитываются, и точка гаснет.
function stampSeen(qc: QueryClient, id: string) {
  markSeen(id)
    .then(() => qc.invalidateQueries({ queryKey: ["tickets"] }))
    .catch(() => {});
}

// Пока панель открыта и карточка загружена, отметка держится новее последнего
// события: открытие и комментарий исполнителя, пришедший при открытой панели,
// не оставят точку. Ключ повтора это (заявка, последнее событие) и НЕ включает
// manager_seen_at: успешный штамп меняет отметку, и с ней в ключе карточка,
// всё ещё считающаяся непрочитанной, штамповалась бы снова и снова. А она может
// ею остаться: отметку ставят часы Node, время события часы Postgres, и при
// расхождении (или событии из будущего) условие «событие новее отметки»
// держится после штампа. По этому ключу цикл невозможен ни при каких часах:
// одна попытка на каждое новое событие, после отказа тоже.
function useKeepSeen(card: TicketCard, open: boolean) {
  const qc = useQueryClient();
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !cardHasUnread(card)) return;
    const key = `${card.id}|${lastEventOf(card) ?? ""}`;
    if (tried.current === key) return;
    tried.current = key;
    stampSeen(qc, card.id);
  }, [open, card, qc]);
}

// Действия панели. Отметка «филиал посмотрел» входит в саму mutationFn, а не
// в обработчик успеха из mutate(): те не вызываются, если панель уже закрыта и
// карточка размонтирована (отправил комментарий и сразу закрыл), а mutationFn
// и обработчик самого хука доезжают всегда. Сбой отметки глотается: действие
// уже выполнено, а точка у приёмки не нужна (закрытая заявка её не носит).
function usePanelActions() {
  const qc = useQueryClient();
  // Блочное тело, а не выражение: TanStack ждёт промис, который вернёт onSuccess,
  // и тогда isPending (кнопки «Принимаем…» и отправка комментария) тянулся бы
  // через перезапрос списка и карточки, а при зависшей сети панель показывала
  // бы «Принимаем…» у уже закрытой заявки.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tickets"] });
  };
  // Отметку не ждём: действие уже выполнено, и его завершение не должно зависеть
  // от второго запроса. Перечитываем после неё ещё раз, чтобы точка погасла.
  const quietSeen = (id: string) => {
    markSeen(id)
      .then(invalidate)
      .catch(() => {});
  };
  return {
    close: useMutation({
      mutationFn: async (id: string) => {
        const r = await closeTicket(id);
        quietSeen(id);
        return r;
      },
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: async (v: { id: string; comment: string }) => {
        const r = await reopenTicket(v.id, v.comment);
        quietSeen(v.id);
        return r;
      },
      onSuccess: invalidate,
    }),
    comment: useMutation({
      mutationFn: async (v: { id: string; body: string }) => {
        const r = await addComment(v.id, v.body);
        quietSeen(v.id);
        return r;
      },
      onSuccess: invalidate,
    }),
  };
}

// ---------------------------------------------------------------------------
// секции
// ---------------------------------------------------------------------------

const RESULT_TEXT: Record<Exclude<ResultColumn, "photos">, { title: string; hint?: string }> = {
  not_submitted: {
    title: "Исполнитель ещё не сдал работу",
    hint: "Когда он сдаст работу, здесь появятся фото результата и кнопка «Принять работу».",
  },
  submitted_without_photos: {
    title: "Исполнитель сдал работу без фото результата",
    hint: "Принять работу без фото нельзя: верните её в работу и попросите приложить фото.",
  },
  none: { title: "Фото результата не приложены" },
};

function ResultPlaceholder({ kind }: { kind: Exclude<ResultColumn, "photos"> }) {
  const t = RESULT_TEXT[kind];
  return (
    <div
      role="status"
      data-result-placeholder={kind}
      className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center"
    >
      <Hourglass className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-base font-medium">{t.title}</p>
      {t.hint && <p className="max-w-xs text-sm leading-snug text-muted-foreground">{t.hint}</p>}
    </div>
  );
}

function Thread({
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
  const comments = card.comments ?? [];
  return (
    <Section title="Переписка">
      {comments.length === 0 ? (
        <Empty>Комментариев пока нет.</Empty>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{actorLabel(c.author_kind)}</span>
                <span className="tabular-nums">{fmtTs(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-base">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Написать комментарий"
          aria-label="Новый комментарий"
          rows={2}
          disabled={sending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button className="h-11 px-5 text-base" onClick={onSend} disabled={sending || draft.trim() === ""}>
            {sending ? "Отправляем…" : "Отправить"}
          </Button>
          {error ? (
            <span role="alert" className="text-sm text-destructive">
              {apiMessage(error)}
            </span>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// карточка
// ---------------------------------------------------------------------------

function CardView({
  card,
  open,
  canClose,
  onClose,
}: {
  card: TicketCard;
  open: boolean;
  canClose: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Закрытие панели передаётся в mutate() только для приёмки и возврата:
  // отправка комментария панель оставляет.
  const actions = usePanelActions();
  const [draft, setDraft] = useState("");
  const [returnComment, setReturnComment] = useState("");
  // Защёлка от двойного нажатия: isPending мутации меняется только на
  // следующем рендере, и два нажатия в одном тике отправили бы два запроса.
  // После успеха остаётся поднятой (панель закрывается), после сбоя снимается.
  const latch = useRef(false);

  useKeepSeen(card, open);

  const statusMutations = [actions.close, actions.reopen];
  const busy = statusMutations.some((m) => m.isPending);
  const failure = statusMutations.find((m) => m.isError)?.error;

  const run = (start: (opts: { onSuccess: () => void; onError: (e: Error) => void }) => void) => {
    if (latch.current) return;
    latch.current = true;
    statusMutations.forEach((m) => m.reset());
    start({
      // Отметка после приёмки и возврата уже поставлена в mutationFn.
      onSuccess: onClose,
      onError: (e) => {
        latch.current = false;
        // При 409 карточка на экране устарела: обновляем её, чтобы кнопки
        // соответствовали настоящему статусу.
        if ((e as ApiError).status === 409) qc.invalidateQueries({ queryKey: ["tickets"] });
      },
    });
  };

  const typeName = card.type?.name_ru ?? "Тип удалён";
  const terminal = card.terminal_name ?? "Филиал не найден";
  const executor = card.assigned_executor_id ? (card.executor_name ?? "Исполнитель удалён") : "не назначен";
  const problem = (card.attachments ?? []).filter((a) => a.phase === "problem");
  // Только снимки текущей сдачи: возврат в работу вложений не удаляет.
  const result = currentResultPhotos(card);
  const column = resultColumn(card.status, result.length);
  const accept = canAccept(card.status, result.length);
  const hasAmount = card.work_total_amount !== null && card.work_total_amount !== undefined;

  return (
    <>
      <SheetHeader className="shrink-0 space-y-1.5 border-b px-5 py-4 pr-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="font-mono text-xl tabular-nums">{card.number}</SheetTitle>
              <StatusBadge status={card.status} />
              <PriorityBadge priority={card.priority} />
            </div>
            <SheetDescription className="text-base text-foreground">
              {typeName} · {terminal}
            </SheetDescription>
          </div>
          {/* Встроенный крестик панели 16 px, а на планшете нужно 44: он скрыт
              классом на SheetContent, закрывает эта кнопка (и Esc, и тап мимо). */}
          <SheetClose asChild>
            <Button variant="outline" className="h-11 shrink-0 px-5 text-base">
              Закрыть
            </Button>
          </SheetClose>
        </div>
        <p className="text-sm leading-snug text-muted-foreground">
          Создана {fmtTs(card.created_at)}, автор: {card.author_name ?? "неизвестен"}. Исполнитель: {executor}.
          {card.reopen_count > 0 ? ` Возвращалась в работу: ${card.reopen_count}.` : ""}{" "}
          {(card.status === "new" || card.status === "in_progress" || card.status === "done") && (
            <>
              Висит:{" "}
              <WaitingFor
                status={card.status}
                created_at={card.created_at}
                assigned_at={card.assigned_at}
                done_at={card.done_at}
              />
              .
            </>
          )}
        </p>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <FieldsSection card={card} />

        <div className="grid gap-6 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.7fr)_minmax(13rem,0.8fr)]">
          <div className="space-y-3" data-column="was">
            <h3 className="text-lg font-semibold">Было</h3>
            <PhotoStrip title="Фото проблемы" items={problem} empty="Менеджер не приложил фото" />
          </div>

          <div className="space-y-4" data-column="work">
            <h3 className="text-lg font-semibold">Работы и итог</h3>
            <ActSection card={card} />
            <PaymentSection card={card} />
            {hasAmount && (
              <p className="text-sm leading-snug text-muted-foreground">
                Сумму утверждает офис, здесь её изменить нельзя.
              </p>
            )}
          </div>

          <div className="space-y-3" data-column="became">
            <h3 className="text-lg font-semibold">Стало</h3>
            {column === "photos" ? (
              <PhotoStrip title="Фото результата" items={result} empty="Фото результата не приложены" />
            ) : (
              <ResultPlaceholder kind={column} />
            )}
          </div>
        </div>

        <Thread
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
        {card.status === "done" && canClose && (
          <div className="space-y-2">
            {canReturn(card.status) && (
              <Textarea
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                placeholder="Что переделать (нужно, чтобы вернуть в работу)"
                aria-label="Комментарий к возврату в работу"
                rows={2}
                disabled={busy}
              />
            )}
            <div className="flex flex-wrap items-center gap-3">
              {accept && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button className="h-12 px-6 text-base" disabled={busy}>
                      {actions.close.isPending ? "Принимаем…" : "Принять работу"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Принять работу по заявке {card.number}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Заявка закроется, исполнитель получит сообщение.
                        {hasAmount ? ` Сумма ${formatAmount(card.work_total_amount)} уйдёт на утверждение офиса.` : ""}{" "}
                        Отменить приёмку нельзя.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-11 px-5 text-base">Не принимать</AlertDialogCancel>
                      <AlertDialogAction
                        className="h-11 px-5 text-base"
                        onClick={() => run((o) => actions.close.mutate(card.id, o))}
                      >
                        Принять работу
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button
                variant="outline"
                className="h-12 px-6 text-base"
                disabled={busy || returnComment.trim() === ""}
                onClick={() =>
                  run((o) => actions.reopen.mutate({ id: card.id, comment: returnComment.trim() }, o))
                }
              >
                {actions.reopen.isPending ? "Возвращаем…" : "Вернуть в работу"}
              </Button>
            </div>
          </div>
        )}

        {card.status === "done" && !canClose && (
          <p className="text-sm text-muted-foreground">
            Принять работу или вернуть её в работу может роль с правом{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">tickets.close</code>. У вашей роли его
            нет: попросите администратора.
          </p>
        )}

        {(card.status === "new" || card.status === "in_progress") && (
          <p className="text-sm text-muted-foreground">Принимать пока нечего: ждём, когда исполнитель сдаст работу.</p>
        )}

        {(card.status === "closed" || card.status === "cancelled") && (
          <p className="text-sm text-muted-foreground">
            {card.status === "closed" ? "Заявка закрыта" : "Заявка отменена"}, действий нет.
          </p>
        )}

        {failure ? (
          <p role="alert" className="text-sm leading-snug text-destructive">
            {actionError(failure)}
          </p>
        ) : null}
      </div>
    </>
  );
}

// Загрузка, ошибка и «нет такой заявки» различимы и ни одна не вечная.
function PanelBody({
  ticketId,
  open,
  canClose,
  onClose,
}: {
  ticketId: string;
  open: boolean;
  canClose: boolean;
  onClose: () => void;
}) {
  const { data: card, isPending, isError, error, isFetching, refetch } = useTicketCard(ticketId);

  if (card) return <CardView card={card} open={open} canClose={canClose} onClose={onClose} />;

  const apiError = error as ApiError | null;
  const status = apiError?.status;
  return (
    <>
      <SheetHeader className="shrink-0 border-b px-5 py-4 text-left">
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-lg">Заявка</SheetTitle>
          <SheetClose asChild>
            <Button variant="outline" className="h-11 shrink-0 px-5 text-base">
              Закрыть
            </Button>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">Карточка заявки</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={isPending}>
        {isPending ? (
          <div className="space-y-4 px-5 py-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError && status === 404 ? (
          <Notice
            icon={<TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />}
            title="Заявка не найдена"
          >
            <p className="text-sm leading-snug text-muted-foreground">
              Её могли удалить, либо она относится к филиалу, которого нет в вашем доступе.
            </p>
          </Notice>
        ) : isError && status === 403 ? (
          <Notice icon={<ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />} title="Нет доступа к заявке">
            <p className="text-sm leading-snug text-muted-foreground">
              Сервер ответил отказом (403). Для карточки нужно право{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">tickets.list</code>.
            </p>
          </Notice>
        ) : (
          <Notice
            icon={<TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />}
            title={status === undefined ? "Нет связи с сервером" : "Не удалось загрузить заявку"}
          >
            <p className="break-words text-sm leading-snug text-muted-foreground">
              {apiError ? apiMessage(apiError) : "Неизвестная ошибка"}
            </p>
            <Button variant="outline" className="h-11 px-5 text-base" onClick={() => refetch()} disabled={isFetching}>
              <RotateCw className={isFetching ? "size-4 animate-spin" : "size-4"} />
              {isFetching ? "Повторяем…" : "Повторить"}
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

export function AcceptPanel({
  ticketId,
  canClose,
  onClose,
}: {
  ticketId: string | null;
  canClose: boolean;
  onClose: () => void;
}) {
  const { shown, epoch } = useSheetSession(ticketId);
  // Фокус после закрытия возвращается на карточку списка: с клавиатуры (или
  // внешней клавиатуры планшета) человек не теряет место.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Sheet open={ticketId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-6xl [&>button]:hidden"
        onOpenAutoFocus={() => {
          opener.current = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        {shown !== null && (
          <PanelBody
            key={`${shown}:${epoch}`}
            ticketId={shown}
            open={ticketId !== null}
            canClose={canClose}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
