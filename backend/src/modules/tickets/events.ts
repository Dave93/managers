import { ticket_events } from "backend/drizzle/schema";

export type TicketEventType =
  | "created"
  | "assigned"
  | "comment"
  | "done_submitted"
  | "reopened"
  | "closed"
  | "cancelled"
  | "payment_approved"
  | "payment_rejected";

export type ActorKind = "manager" | "executor" | "office" | "system";

export type EventInput = {
  ticket_id: string;
  type: TicketEventType;
  actor_kind: ActorKind;
  actor_user_id?: string | null;
  actor_executor_id?: string | null;
  payload?: Record<string, unknown>;
};

// Пишется ТОЛЬКО внутри той же транзакции, что и сама смена заявки. Событие,
// записанное отдельным запросом после коммита, теряется при любом падении
// между двумя запросами — и рассылка по нему не уйдёт никогда.
export async function writeEvent(tx: any, input: EventInput): Promise<{ id: string }> {
  const [row] = await tx
    .insert(ticket_events)
    .values({
      ticket_id: input.ticket_id,
      type: input.type,
      actor_kind: input.actor_kind,
      actor_user_id: input.actor_user_id ?? null,
      actor_executor_id: input.actor_executor_id ?? null,
      payload: input.payload ?? {},
    })
    .returning({ id: ticket_events.id });
  return row;
}
