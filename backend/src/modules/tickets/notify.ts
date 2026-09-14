import { ticket_notifications, ticket_executors, ticket_types, tickets, ticket_events } from "backend/drizzle/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { routeEvent, type Recipient, type RoutingInput } from "./routing";
import { enqueueNotifications } from "./queue";

export type NotificationRow = {
  event_id: string;
  recipient_executor_id: string;
  recipient_chat_id: number;
  kind: "send" | "edit";
  target_message_id: number | null;
  status: "pending";
};

// Уникальность в базе стоит на (event_id, recipient_chat_id, kind), поэтому
// одинаковые адресаты схлопываются здесь, а не ловятся как ошибка вставки.
export function buildNotificationRows(eventId: string, recipients: Recipient[]): NotificationRow[] {
  const seen = new Set<string>();
  const rows: NotificationRow[] = [];
  for (const r of recipients) {
    const key = `${r.chat_id}:${r.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      event_id: eventId,
      recipient_executor_id: r.executor_id,
      recipient_chat_id: r.chat_id,
      kind: r.kind,
      target_message_id: r.kind === "edit" ? r.target_message_id : null,
      status: "pending",
    });
  }
  return rows;
}

// Вызывается ВНУТРИ транзакции, которая меняет заявку. Возвращает id строк,
// которые вызывающий ставит в очередь ПОСЛЕ коммита: задача, поставленная до
// коммита, может прийти воркеру раньше, чем строка станет видимой.
export async function recordNotifications(
  tx: any,
  input: {
    eventId: string;
    ticketId: string;
    eventType: RoutingInput["event"]["type"];
    actorKind: RoutingInput["event"]["actor_kind"];
    actorExecutorId?: string | null;
  }
): Promise<string[]> {
  const [ticket] = await tx
    .select({
      id: tickets.id,
      status: tickets.status,
      assigned_executor_id: tickets.assigned_executor_id,
      type_id: tickets.type_id,
    })
    .from(tickets)
    .where(eq(tickets.id, input.ticketId))
    .execute();
  if (!ticket) return [];

  const [type] = await tx
    .select({ contractor_id: ticket_types.contractor_id })
    .from(ticket_types)
    .where(eq(ticket_types.id, ticket.type_id))
    .execute();
  if (!type?.contractor_id) return [];

  const firmExecutors = await tx
    .select({
      id: ticket_executors.id,
      tg_user_id: ticket_executors.tg_user_id,
      lang: ticket_executors.lang,
      is_active: ticket_executors.is_active,
    })
    .from(ticket_executors)
    .where(eq(ticket_executors.contractor_id, type.contractor_id))
    .execute();

  // Ранее разосланные сообщения ЭТОЙ заявки — чтобы погасить кнопку у тех,
  // кто не успел её нажать. ticket_notifications привязан к заявке только
  // через ticket_events.ticket_id, поэтому здесь обязателен join и фильтр
  // по ticketId — без него подобрались бы отправленные уведомления ЛЮБОЙ
  // заявки в системе, и правка кнопок улетела бы в чужие чаты.
  const broadcast = await tx
    .select({
      executor_id: ticket_notifications.recipient_executor_id,
      chat_id: ticket_notifications.recipient_chat_id,
      tg_message_id: ticket_notifications.tg_message_id,
    })
    .from(ticket_notifications)
    .innerJoin(ticket_events, eq(ticket_events.id, ticket_notifications.event_id))
    .where(
      and(
        eq(ticket_events.ticket_id, input.ticketId),
        eq(ticket_notifications.status, "sent"),
        isNotNull(ticket_notifications.tg_message_id)
      )
    )
    .execute();

  const recipients = routeEvent({
    event: { type: input.eventType, actor_kind: input.actorKind, actor_executor_id: input.actorExecutorId ?? null },
    ticket: { id: ticket.id, status: ticket.status, assigned_executor_id: ticket.assigned_executor_id },
    firmExecutors,
    broadcast: broadcast.filter((b: any) => b.executor_id),
  });

  const rows = buildNotificationRows(input.eventId, recipients);
  if (rows.length === 0) return [];

  const inserted = await tx
    .insert(ticket_notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: ticket_notifications.id });

  return inserted.map((r: any) => r.id);
}

export { enqueueNotifications };
