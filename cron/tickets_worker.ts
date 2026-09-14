import { Queue, Worker, DelayedError, type Job } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { drizzleDb } from "@backend/lib/db";
import {
  ticket_notifications,
  ticket_events,
  tickets,
  ticket_types,
  terminals,
  ticket_executors,
} from "backend/drizzle/schema";
import { buildMessage, type MessageEvent } from "@backend/modules/tickets/messages";
import { editMessageText, sendMessage } from "@backend/modules/tickets/telegram";
import { TICKETS_QUEUE, TICKETS_SWEEP_JOB, jobOptions, redisConnection } from "@backend/modules/tickets/queue";

const BOT_TOKEN = process.env.TICKETS_BOT_TOKEN ?? "";
const MINIAPP_URL = process.env.TICKETS_MINIAPP_URL ?? "https://api.office.lesailes.uz/tickets-app/";

if (!BOT_TOKEN) {
  console.error("tickets worker: TICKETS_BOT_TOKEN не задан — доставка невозможна");
  process.exit(1);
}

// Правки текстов сообщений живут в backend, но исполняет их ЭТОТ процесс:
// после деплоя бэкенда его нужно перезапускать отдельно, иначе бот шлёт
// старые формулировки при уже новом API.
const queue = new Queue(TICKETS_QUEUE, { connection: redisConnection() });
queue.on("error", (e) => console.error("tickets-notify queue error", e));

queue
  .upsertJobScheduler(
    TICKETS_SWEEP_JOB,
    { pattern: "*/5 * * * *" },
    {
      name: TICKETS_SWEEP_JOB,
      // Без этого повторяющееся задание подметалки копило бы завершённые
      // прогоны в Redis без предела — ровно то, что раздуло очередь arryt до
      // 3.41 ГБ (см. память по BullMQ bloat).
      opts: { removeOnComplete: { count: 10 }, removeOnFail: { age: 86400 } },
    }
  )
  .catch((e) => console.error("tickets worker: sweep registration failed", e));

const EVENT_TO_MESSAGE: Record<string, MessageEvent> = {
  created: "created",
  comment: "comment",
  reopened: "reopened",
  closed: "closed",
  cancelled: "cancelled",
};

async function deliver(job: Job, token: string) {
  const notificationId = job.data.notificationId as string;

  // Захват строки: если её уже забрал другой прогон, выходим молча.
  const claimed = await drizzleDb
    .update(ticket_notifications)
    .set({ status: "sending", attempts: sql`${ticket_notifications.attempts} + 1` })
    .where(and(eq(ticket_notifications.id, notificationId), eq(ticket_notifications.status, "pending")))
    .returning()
    .execute();
  if (claimed.length === 0) return { skipped: true };

  const n = claimed[0];

  const [ctx] = await drizzleDb
    .select({
      ticket_id: ticket_events.ticket_id,
      event_type: ticket_events.type,
      payload: ticket_events.payload,
      status: tickets.status,
      seq: tickets.seq,
      priority: tickets.priority,
      assigned_executor_id: tickets.assigned_executor_id,
      assigned_at: tickets.assigned_at,
      details: tickets.details,
      number_prefix: ticket_types.number_prefix,
      type_name_ru: ticket_types.name_ru,
      type_name_uz: ticket_types.name_uz,
      terminal_name: terminals.name,
    })
    .from(ticket_events)
    .leftJoin(tickets, eq(ticket_events.ticket_id, tickets.id))
    .leftJoin(ticket_types, eq(tickets.type_id, ticket_types.id))
    .leftJoin(terminals, eq(tickets.terminal_id, terminals.id))
    .where(eq(ticket_events.id, n.event_id))
    .execute();

  if (!ctx) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "failed", last_error: "event not found" })
      .where(eq(ticket_notifications.id, n.id))
      .execute();
    return { failed: true };
  }

  // leftJoin к tickets вернул пустые поля — событие есть, а заявки уже нет.
  // Тексты вида "T-null" хуже отсутствия сообщения, и повтор здесь не
  // поможет: заявка не появится обратно.
  if (ctx.seq == null) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "failed", last_error: "ticket not found" })
      .where(eq(ticket_notifications.id, n.id))
      .execute();
    return { failed: true };
  }

  // Чтение получателя и (если нужно) того, кто взял заявку. Ошибка здесь —
  // разовая техническая (например, БД моргнула), а не решение по данным,
  // поэтому строку возвращаем в pending и пробрасываем исключение дальше:
  // пусть обычный бэкофф очереди даст ей ещё одну попытку. Если этого не
  // сделать, строка застрянет в 'sending' навсегда — claim выше и подметалка
  // ниже трогают только 'pending'.
  let executorLang: string | undefined;
  let messageEvent: MessageEvent;
  let takenBy: string | undefined;
  let takenAt: string | undefined;
  try {
    const [recipient] = await drizzleDb
      .select({ lang: ticket_executors.lang })
      .from(ticket_executors)
      .where(eq(ticket_executors.id, n.recipient_executor_id!))
      .execute();
    executorLang = recipient?.lang;

    // Рассылка могла пролежать в очереди те секунды, за которые заявку успели
    // взять или отменить. Сообщение с живой кнопкой на чужую работу хуже, чем
    // отсутствие сообщения.
    messageEvent = EVENT_TO_MESSAGE[ctx.event_type] ?? "created";
    if (ctx.event_type === "created" && ctx.status !== "new") {
      messageEvent = ctx.status === "cancelled" ? "cancelled" : "assigned_other";
    }
    if (ctx.event_type === "assigned") {
      messageEvent = n.kind === "edit" ? "assigned_other" : "assigned_taker";
    }
    if (ctx.event_type === "cancelled" && n.kind === "edit") {
      messageEvent = "cancelled";
    }

    // "assigned_other" сообщает получателю, КТО взял заявку — это исполнитель
    // из tickets.assigned_executor_id, а не n.recipient_executor_id (это сам
    // получатель, то есть тот, кому заявку НЕ дали). Подстановка получателя
    // вместо взявшего показала бы человеку "Взяли вы", хотя взял другой —
    // прямая дорога ко второму подрядчику на объекте.
    if (messageEvent === "assigned_other" && ctx.assigned_executor_id) {
      const [taker] = await drizzleDb
        .select({ full_name: ticket_executors.full_name })
        .from(ticket_executors)
        .where(eq(ticket_executors.id, ctx.assigned_executor_id))
        .execute();
      takenBy = taker?.full_name ?? undefined;
      takenAt = ctx.assigned_at
        ? new Date(ctx.assigned_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : undefined;
    }
  } catch (e) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "pending", last_error: (e as Error).message })
      .where(eq(ticket_notifications.id, n.id))
      .execute()
      .catch(() => {});
    throw e;
  }

  const details = (ctx.details ?? {}) as Record<string, string>;
  const summary = details.symptom ?? details.broken_part ?? details.note ?? "";

  // buildMessage детерминирована и намеренно бросает исключение на
  // неизвестный eventType. Без перехвата такое исключение улетело бы из
  // deliver() необработанным, и — в отличие от ошибки чтения выше — строка
  // осталась бы в 'sending' НЕ временно: та же заявка на следующей попытке
  // даст то же исключение. Ретраить нечего, поэтому это permanent-путь, как
  // и "event not found" / "ticket not found" выше.
  let message: { text: string; reply_markup?: object };
  try {
    message = buildMessage({
      eventType: messageEvent,
      lang: executorLang ?? "ru",
      ticket: {
        id: ctx.ticket_id!,
        number: `${ctx.number_prefix ?? "T"}-${String(ctx.seq).padStart(6, "0")}`,
        priority: (ctx.priority as "normal" | "urgent") ?? "normal",
        terminal_name: ctx.terminal_name ?? "",
        type_name_ru: ctx.type_name_ru ?? "",
        type_name_uz: ctx.type_name_uz ?? "",
        summary_ru: summary,
        summary_uz: summary,
      },
      miniappUrl: MINIAPP_URL,
      comment: (ctx.payload as any)?.comment ?? undefined,
      takenBy,
      takenAt,
    });
  } catch (e) {
    await drizzleDb
      .update(ticket_notifications)
      .set({ status: "failed", last_error: (e as Error).message })
      .where(eq(ticket_notifications.id, n.id))
      .execute();
    return { failed: true };
  }

  const result =
    n.kind === "edit" && n.target_message_id
      ? await editMessageText(BOT_TOKEN, n.recipient_chat_id, n.target_message_id, message)
      : await sendMessage(BOT_TOKEN, n.recipient_chat_id, message);

  if (result.ok) {
    // "message is not modified" отдаёт message_id: null — значит "id не
    // пришёл", а не "id пропал". tg_message_id — это то, во что целятся
    // будущие правки (editOthers в routing.ts), затирать его null нельзя.
    const patch: Record<string, unknown> = { status: "sent", sent_at: new Date().toISOString() };
    if (result.message_id !== null) {
      patch.tg_message_id = result.message_id;
    }
    try {
      await drizzleDb
        .update(ticket_notifications)
        .set(patch)
        .where(eq(ticket_notifications.id, n.id))
        .execute();
    } catch (e) {
      // Сообщение уже долетело до Telegram — ретраить нельзя: claim выше
      // увидит 'sending' и молча выйдет, а повторный sendMessage создал бы
      // дубликат у живого человека. Единственное, что можно сделать —
      // зафиксировать это громко; строка так и останется в 'sending', а
      // tg_message_id для неё не сохранится (известный остаточный риск).
      console.error("tickets worker: сообщение отправлено, но статус не записан", n.id, (e as Error).message);
    }
    return { sent: true };
  }

  await drizzleDb
    .update(ticket_notifications)
    .set({ status: result.permanent ? "failed" : "pending", last_error: result.error })
    .where(eq(ticket_notifications.id, n.id))
    .execute();

  if (result.permanent) return { failed: true };

  if (typeof result.retryAfterMs === "number") {
    // Телеграм явно назвал время ожидания (валидный числовой retry_after) —
    // уважаем его напрямую вместо фиксированного exponential-бэкоффа очереди
    // (queue.ts, который об этом ничего не знает), и это не тратит одну из
    // 5 попыток задания.
    await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
    throw new DelayedError();
  }
  // Обычная временная ошибка (или 429 с нечисловым retry_after — см.
  // telegram.ts) — пусть сработает exponential бэкофф очереди.
  throw new Error(result.error);
}

async function sweep() {
  // Единственный сценарий, который очередь не закрывает: Redis лежал в момент
  // постановки, строка есть, задачи нет.
  const stale = await drizzleDb
    .select({ id: ticket_notifications.id })
    .from(ticket_notifications)
    .where(
      and(
        eq(ticket_notifications.status, "pending"),
        sql`${ticket_notifications.created_at} < now() - interval '2 minutes'`
      )
    )
    .limit(200)
    .execute();
  for (const row of stale) {
    await queue.add("deliver", { notificationId: row.id }, { ...jobOptions, jobId: row.id });
  }
  return { requeued: stale.length };
}

const worker = new Worker(
  TICKETS_QUEUE,
  async (job, token) => {
    if (job.name === TICKETS_SWEEP_JOB) return sweep();
    return deliver(job, token as string);
  },
  {
    connection: redisConnection(),
    concurrency: 5,
    // Потолок телеграма около 30 сообщений в секунду; упираться в него не стоит.
    limiter: { max: 25, duration: 1000 },
  }
);

worker.on("error", (e) => console.error("tickets worker error", e));
worker.on("failed", (job, e) => console.error("tickets job failed", job?.id, e?.message));
console.log("tickets worker started");
