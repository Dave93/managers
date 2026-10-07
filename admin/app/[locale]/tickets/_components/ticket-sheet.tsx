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
//    ставит.

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RotateCw, ShieldAlert, TriangleAlert } from "lucide-react";

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
import { useTicketActions, useTicketCard } from "@admin/lib/use-tickets";
import { PriorityBadge, StatusBadge, parseTs } from "@admin/components/tickets/status";

import { PhotoStrip } from "./photo-strip";

// ---------------------------------------------------------------------------
// подписи и форматирование
// ---------------------------------------------------------------------------

const ACTOR_RU: Record<ActorKind, string> = {
  manager: "Филиал",
  executor: "Исполнитель",
  office: "Офис",
  system: "Система",
};

const EVENT_RU: Record<TicketEventType, string> = {
  created: "Заявка создана",
  assigned: "Назначен исполнитель",
  comment: "Комментарий",
  done_submitted: "Работа сдана",
  reopened: "Возвращена в работу",
  closed: "Работа принята",
  cancelled: "Заявка отменена",
  payment_approved: "Оплата утверждена",
  payment_rejected: "Оплата отклонена",
};

const PAYMENT_RU: Record<PaymentStatus, string> = {
  pending: "на утверждении офиса",
  approved: "утверждена",
  rejected: "отклонена",
};

function actorLabel(kind: ActorKind): string {
  return ACTOR_RU[kind] ?? kind;
}

function fmtTs(value: string | null | undefined): string {
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

// 409 у действий над заявкой значит одно: статус успели поменять до нас
// (другой сотрудник, исполнитель). Текст сервера для close говорит про
// «состояние „сдана“» и человеку ничего не объясняет, поэтому подменяем.
function actionError(error: unknown): string {
  if ((error as ApiError)?.status === 409) {
    return "Статус заявки уже изменился: её успели обработать раньше. Карточка обновлена, проверьте текущий статус.";
  }
  return apiMessage(error);
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function FieldsSection({ card }: { card: TicketCard }) {
  const { rows, schemaKnown } = buildFieldRows(card);
  const description = card.description?.trim();
  return (
    <Section title="Поля заявки">
      {!schemaKnown && (
        <p className="text-[12px] text-muted-foreground">
          Тип заявки недоступен, поэтому подписей полей нет: показаны ключи.
        </p>
      )}
      {rows.length === 0 && !description ? (
        <Empty>В заявке нет заполненных полей.</Empty>
      ) : (
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="break-words">
                {r.value}
                {r.removed && (
                  <span className="ml-2 text-[11px] text-amber-700 dark:text-amber-400">
                    поле удалено из типа
                  </span>
                )}
              </dd>
            </div>
          ))}
          {description && (
            <div className="contents">
              <dt className="text-muted-foreground">Описание</dt>
              <dd className="whitespace-pre-wrap break-words">{description}</dd>
            </div>
          )}
        </dl>
      )}
    </Section>
  );
}

function ActSection({ card }: { card: TicketCard }) {
  const items = card.work_items ?? [];
  return (
    <Section title="Акт выполненных работ">
      {items.length === 0 ? (
        <Empty>Акт не заполнен</Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-1.5 font-medium">№</th>
                <th className="px-3 py-1.5 font-medium">Работа</th>
                <th className="px-3 py-1.5 text-right font-medium">Кол-во</th>
                <th className="px-3 py-1.5 text-right font-medium">Сумма</th>
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatAmount(w.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/20 font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-1.5 text-right">
                  Итого
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                  {formatAmount(card.work_total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

function PaymentSection({ card }: { card: TicketCard }) {
  // Сумма появляется вместе с актом. До него payment_status всё равно
  // «pending», и подпись «на утверждении офиса» у заявки без суммы лгала бы.
  if (card.work_total_amount === null || card.work_total_amount === undefined) return null;
  const status = card.payment_status;
  return (
    <Section title="Оплата">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold tabular-nums">{formatAmount(card.work_total_amount)}</span>
        <span className="text-muted-foreground">{PAYMENT_RU[status] ?? status}</span>
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
  const comments = card.comments ?? [];
  return (
    <Section title="Переписка">
      {comments.length === 0 ? (
        <Empty>Комментариев пока нет.</Empty>
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
          placeholder="Написать комментарий"
          aria-label="Новый комментарий"
          rows={2}
          disabled={sending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={onSend} disabled={sending || draft.trim() === ""}>
            {sending ? "Отправляем…" : "Отправить"}
          </Button>
          {error ? (
            <span role="alert" className="text-[12.5px] text-destructive">
              {apiMessage(error)}
            </span>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function EventsSection({ events }: { events: TicketEventRow[] }) {
  return (
    <Section title="Лента событий">
      {events.length === 0 ? (
        <Empty>Событий пока нет.</Empty>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {events.map((e) => {
            const note = typeof e.payload?.comment === "string" ? e.payload.comment : null;
            return (
              <li key={e.id}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{EVENT_RU[e.type] ?? e.type}</span>
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
  const qc = useQueryClient();
  // Без onDone: хук вызывает его после ЛЮБОЙ мутации, в том числе после
  // комментария, и отправка сообщения закрыла бы панель. Закрытие передаётся
  // в mutate() только для трёх действий над статусом.
  const actions = useTicketActions();
  const [draft, setDraft] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const statusMutations = [actions.close, actions.reopen, actions.cancel];
  const busy = statusMutations.some((m) => m.isPending);
  const failure = statusMutations.find((m) => m.isError)?.error;

  const run = (start: (opts: { onSuccess: () => void; onError: (e: Error) => void }) => void) => {
    statusMutations.forEach((m) => m.reset());
    start({
      onSuccess: onClose,
      // При 409 карточка на экране устарела: обновляем её, чтобы кнопки
      // соответствовали настоящему статусу.
      onError: (e) => {
        if ((e as ApiError).status === 409) qc.invalidateQueries({ queryKey: ["tickets"] });
      },
    });
  };

  const typeName = card.type?.name_ru ?? "Тип удалён";
  const terminal = card.terminal_name ?? "Филиал не найден";
  const executor = card.assigned_executor_id
    ? (card.executor_name ?? "Исполнитель удалён")
    : "не назначен";
  const problem = (card.attachments ?? []).filter((a) => a.phase === "problem");
  const result = (card.attachments ?? []).filter((a) => a.phase === "result");
  const resultEmpty =
    card.status === "new" || card.status === "in_progress"
      ? "Исполнитель ещё не сдал работу"
      : "Фото результата не приложены";

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
          Создана {fmtTs(card.created_at)}, автор: {card.author_name ?? "неизвестен"}. Исполнитель: {executor}.
          {card.reopen_count > 0 ? ` Возвращалась в работу: ${card.reopen_count}.` : ""}
        </p>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
        <FieldsSection card={card} />
        <PhotoStrip title="Фото проблемы" items={problem} empty="Менеджер не приложил фото" />
        <PhotoStrip title="Фото результата" items={result} empty={resultEmpty} />
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
        {card.status === "done" && (
          <div className="space-y-2">
            <Textarea
              value={returnComment}
              onChange={(e) => setReturnComment(e.target.value)}
              placeholder="Что переделать (нужно, чтобы вернуть в работу)"
              aria-label="Комментарий к возврату в работу"
              rows={2}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={() => run((o) => actions.close.mutate(card.id, o))}>
                {actions.close.isPending ? "Принимаем…" : "Принять работу"}
              </Button>
              <Button
                variant="outline"
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

        {(card.status === "new" || card.status === "in_progress") && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                {actions.cancel.isPending ? "Отменяем…" : "Отменить"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Отменить заявку {card.number}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Отменённую заявку нельзя вернуть в работу: если работа всё же нужна, придётся создать новую заявку.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Причина (необязательно)"
                aria-label="Причина отмены"
                rows={2}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>Не отменять</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const comment = cancelReason.trim();
                    run((o) =>
                      actions.cancel.mutate({ id: card.id, ...(comment ? { comment } : {}) }, o)
                    );
                  }}
                >
                  Отменить заявку
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(card.status === "closed" || card.status === "cancelled") && (
          <p className="text-sm text-muted-foreground">
            {card.status === "closed" ? "Заявка закрыта" : "Заявка отменена"}, действий нет.
          </p>
        )}

        {failure ? (
          <p role="alert" className="text-[12.5px] leading-snug text-destructive">
            {actionError(failure)}
          </p>
        ) : null}
      </div>
    </>
  );
}

// Загрузка, ошибка и «нет такой заявки» различимы и ни одна не вечная.
function Notice({
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
  const { data: card, isPending, isError, error, isFetching, refetch } = useTicketCard(ticketId);

  if (card) return <CardView card={card} onClose={onClose} />;

  const apiError = error as ApiError | null;
  const status = apiError?.status;
  return (
    <>
      <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
        <SheetTitle className="text-base">Заявка</SheetTitle>
        <SheetDescription className="sr-only">Карточка заявки</SheetDescription>
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
            title="Заявка не найдена"
          >
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              Её могли удалить, либо она относится к филиалу, которого нет в вашем доступе.
            </p>
          </Notice>
        ) : isError && status === 403 ? (
          <Notice
            icon={<ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />}
            title="Нет доступа к заявке"
          >
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              Сервер ответил отказом (403). Для карточки нужно право{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">tickets.list</code>.
            </p>
          </Notice>
        ) : (
          <Notice
            icon={<TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />}
            title={status === undefined ? "Нет связи с сервером" : "Не удалось загрузить заявку"}
          >
            <p className="break-words text-[12.5px] leading-snug text-muted-foreground">
              {apiError ? apiMessage(apiError) : "Неизвестная ошибка"}
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RotateCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
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

// Пока панель закрывается, ticketId уже null, но Radix ещё 300 мс рисует
// уходящую панель: без запомненного id она выехала бы пустой. А «эпоха»
// растёт при каждом новом открытии, чтобы повторное открытие той же заявки
// не принесло старый черновик и старую ошибку действия.
function useSheetSession(ticketId: string | null) {
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
