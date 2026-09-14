export type ExecutorRow = {
  id: string;
  tg_user_id: number | null;
  lang: string;
  is_active: boolean;
};

export type BroadcastRow = {
  executor_id: string;
  chat_id: number;
  tg_message_id: number | null;
};

export type RoutingInput = {
  event: {
    type:
      | "created" | "assigned" | "comment" | "done_submitted"
      | "reopened" | "closed" | "cancelled"
      | "payment_approved" | "payment_rejected";
    actor_kind: "manager" | "executor" | "office" | "system";
    actor_executor_id?: string | null;
  };
  ticket: { id: string; status: string; assigned_executor_id: string | null };
  firmExecutors: ExecutorRow[];
  // Уже разосланные сообщения по этой заявке: кому и какое. Нужны, чтобы
  // погасить кнопку «Беру» у тех, кто не успел.
  broadcast: BroadcastRow[];
};

export type Recipient =
  | { executor_id: string; chat_id: number; lang: string; kind: "send" }
  | { executor_id: string; chat_id: number; lang: string; kind: "edit"; target_message_id: number };

const reachable = (e: ExecutorRow): boolean => e.is_active && typeof e.tg_user_id === "number";

const send = (e: ExecutorRow): Recipient & { kind: "send" } => ({
  executor_id: e.id,
  chat_id: e.tg_user_id as number,
  lang: e.lang,
  kind: "send",
});

// Гашение кнопки у всех, кроме указанного исполнителя. Заявка уже не `new`,
// и живая кнопка «Беру» у остальных — это выезд на объект, где чинить нечего.
function editOthers(input: RoutingInput, exceptExecutorId: string | null): (Recipient & { kind: "edit" })[] {
  const byId = new Map(input.firmExecutors.map((e) => [e.id, e]));
  return input.broadcast
    .filter((b) => b.executor_id !== exceptExecutorId && typeof b.tg_message_id === "number")
    .map((b) => ({
      executor_id: b.executor_id,
      chat_id: b.chat_id,
      lang: byId.get(b.executor_id)?.lang ?? "ru",
      kind: "edit" as const,
      target_message_id: b.tg_message_id as number,
    }));
}

function assignedExecutor(input: RoutingInput): ExecutorRow | undefined {
  const id = input.ticket.assigned_executor_id;
  if (!id) return undefined;
  return input.firmExecutors.find((e) => e.id === id && reachable(e));
}

export function routeEvent(input: RoutingInput): Recipient[] {
  switch (input.event.type) {
    case "created":
      return input.firmExecutors.filter(reachable).map(send);

    case "assigned": {
      const taker = assignedExecutor(input);
      return [...editOthers(input, input.ticket.assigned_executor_id), ...(taker ? [send(taker)] : [])];
    }

    case "comment": {
      // Только комментарий менеджера уходит наружу: исполнитель свой
      // комментарий уже видит, а менеджеру телеграм мы не шлём вовсе.
      if (input.event.actor_kind === "executor") return [];
      const target = assignedExecutor(input);
      return target ? [send(target)] : [];
    }

    case "reopened":
    case "closed": {
      const target = assignedExecutor(input);
      return target ? [send(target)] : [];
    }

    case "cancelled": {
      const target = assignedExecutor(input);
      return [...editOthers(input, input.ticket.assigned_executor_id), ...(target ? [send(target)] : [])];
    }

    // Сдача работы — событие для филиала, он видит его на планшете.
    case "done_submitted":
    // Деньги наружу не уходят: подрядчик узнаёт об оплате не из бота.
    // Поведение закреплено тестом, иначе первый же рефакторинг превратит
    // внутреннее финансовое решение в сообщение контрагенту.
    case "payment_approved":
    case "payment_rejected":
      return [];

    default: {
      const _exhaustive: never = input.event.type;
      throw new Error(`routeEvent: неизвестный тип события ${_exhaustive}`);
    }
  }
}
