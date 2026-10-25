// Доставка одного уведомления из kpi_notifications и подметалка. Вызывается только из воркера.
// После захвата строки (status = 'sending') ни одна ветка не оставляет её в этом статусе.
import { kpi_notifications } from "backend/drizzle/schema";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { now } from "../clock";
import { isPeriodClosed } from "../periods";
import { KPI_DELIVER_JOB, deliverJobOptions } from "../queue";
import { loadSettings } from "../settings";
import { disputeDeadline, isPeriod } from "../time";
import type { BotApi } from "../tg/bot-api";
import { recipientOf } from "../tg/bindings";
import { DISPUTABLE_KINDS, UnknownKindError, buildMessage, type OutMessage } from "../tg/messages";

export type DeliverOutcome =
  | { result: "noop" }
  | { result: "sent" }
  | { result: "skipped"; reason: "no_token" | "no_binding" | "inactive_recipient" }
  | { result: "failed"; error: string }
  | { result: "retry"; error: string; retryAfterMs?: number };

type Row = typeof kpi_notifications.$inferSelect;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function settle(
  db: DbLike,
  id: string,
  status: "pending" | "sent" | "failed" | "skipped",
  extra: { last_error?: string; tg_message_id?: string | null } = {}
): Promise<void> {
  await db
    .update(kpi_notifications)
    .set({
      status,
      ...(extra.last_error !== undefined ? { last_error: extra.last_error } : {}),
      ...(extra.tg_message_id != null ? { tg_message_id: extra.tg_message_id } : {}),
      // Успех после временных ошибок не должен хранить старый текст ошибки.
      ...(status === "sent" ? { sent_at: sql`now()`, last_error: null } : {}),
    })
    .where(eq(kpi_notifications.id, id));
}

// Временная ошибка: строка снова pending, а на последней попытке очереди — failed.
async function temporary(
  db: DbLike,
  id: string,
  error: string,
  lastAttempt: boolean,
  retryAfterMs?: number
): Promise<DeliverOutcome> {
  if (lastAttempt) {
    await settle(db, id, "failed", { last_error: error });
    return { result: "failed", error };
  }
  await settle(db, id, "pending", { last_error: error });
  return retryAfterMs === undefined ? { result: "retry", error } : { result: "retry", error, retryAfterMs };
}

// Кнопка и строка про срок споров только пока он не вышел и месяц не закрыт.
async function disputeUntilOf(db: DbLike, row: Row): Promise<string | null> {
  if (!(DISPUTABLE_KINDS as readonly string[]).includes(row.kind)) return null;
  const period = (row.payload as Record<string, unknown> | null)?.period;
  if (!isPeriod(period)) return null;
  const settings = await loadSettings(db);
  const deadline = disputeDeadline(period, settings.dispute_deadline_day);
  if (now().getTime() > deadline.getTime()) return null;
  if (await isPeriodClosed(db, period)) return null;
  return deadline.toISOString();
}

export async function deliverOne(
  db: DbLike,
  id: string,
  deps: { api: BotApi | null; lastAttempt: boolean }
): Promise<DeliverOutcome> {
  const [row] = await db
    .update(kpi_notifications)
    .set({ status: "sending", attempts: sql`${kpi_notifications.attempts} + 1` })
    .where(and(eq(kpi_notifications.id, id), eq(kpi_notifications.status, "pending")))
    .returning();
  if (!row) return { result: "noop" };

  if (!deps.api) {
    await settle(db, id, "skipped", { last_error: "no_token" });
    return { result: "skipped", reason: "no_token" };
  }

  let chat: { chat_id: number; lang: "ru" | "uz" };
  let disputeUntil: string | null;
  try {
    const rec = await recipientOf(db, row);
    if (rec === "inactive") {
      await settle(db, id, "skipped", { last_error: "inactive_recipient" });
      return { result: "skipped", reason: "inactive_recipient" };
    }
    if (!rec) {
      await settle(db, id, "skipped", { last_error: "no_binding" });
      return { result: "skipped", reason: "no_binding" };
    }
    chat = rec;
    disputeUntil = await disputeUntilOf(db, row);
  } catch (e) {
    return temporary(db, id, errText(e), deps.lastAttempt);
  }

  let msg: OutMessage;
  try {
    msg = buildMessage(row.kind, row.payload as Record<string, unknown>, { lang: chat.lang, disputeUntil });
  } catch (e) {
    const error = e instanceof UnknownKindError ? `unknown_kind:${row.kind}` : errText(e);
    await settle(db, id, "failed", { last_error: error });
    return { result: "failed", error };
  }

  let res;
  try {
    res = await deps.api.send(chat.chat_id, msg);
  } catch (e) {
    return temporary(db, id, errText(e), deps.lastAttempt);
  }
  if (res.ok) {
    await settle(db, id, "sent", { tg_message_id: res.message_id === null ? null : String(res.message_id) });
    return { result: "sent" };
  }
  if (res.permanent) {
    await settle(db, id, "failed", { last_error: res.error });
    return { result: "failed", error: res.error };
  }
  if (res.retryAfterMs !== undefined) {
    // Лимит Telegram — не вина сообщения: строка остаётся pending, пауза задаётся очереди.
    await settle(db, id, "pending", { last_error: res.error });
    return { result: "retry", error: res.error, retryAfterMs: res.retryAfterMs };
  }
  return temporary(db, id, res.error, deps.lastAttempt);
}

// pending старше olderThanSec (по часам базы), старые первыми.
export async function pendingIds(db: DbLike, olderThanSec: number, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: kpi_notifications.id })
    .from(kpi_notifications)
    .where(
      and(
        eq(kpi_notifications.status, "pending"),
        lt(kpi_notifications.created_at, sql`now() - make_interval(secs => ${olderThanSec})`)
      )
    )
    .orderBy(asc(kpi_notifications.created_at), asc(kpi_notifications.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

// Строки в sending дольше olderThanMin: воркер упал между захватом и итогом. Сами не чиним, только считаем.
export async function stuckSendingCount(db: DbLike, olderThanMin: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(kpi_notifications)
    .where(
      and(
        eq(kpi_notifications.status, "sending"),
        lt(kpi_notifications.created_at, sql`now() - make_interval(mins => ${olderThanMin})`)
      )
    );
  return r?.n ?? 0;
}

// Строка, которую очередь уже пробовала столько раз, возвращается в pending по кругу: сдаёмся.
export const MAX_ATTEMPTS = 20;

export interface SweepQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | null | undefined>;
  remove(jobId: string): Promise<unknown>;
  add(name: string, data: unknown, opts: Record<string, unknown>): Promise<unknown>;
}

// Состояния, в которых задачу ведёт очередь: подметалка её не трогает.
const LIVE_STATES = new Set(["delayed", "waiting", "active", "prioritized", "waiting-children"]);

// Подметалка: ставит в очередь pending-строки старше olderThanSec. BullMQ держит завершённые и упавшие
// задачи с тем же jobId до суток и молча игнорирует повторный add, поэтому такую задачу сначала убираем.
// Задачу в живом состоянии (в том числе отложенную из-за 429) не трогаем: иначе подметалка сбросила бы
// паузу Telegram и спровоцировала бы новые 429. Строки с attempts >= MAX_ATTEMPTS получают failed.
export async function sweepPending(
  db: DbLike,
  queue: SweepQueue,
  opts: { olderThanSec?: number; limit?: number } = {}
): Promise<{ queued: number; skipped: number; busy: number; failed: number }> {
  const gaveUp = await db
    .update(kpi_notifications)
    .set({ status: "failed", last_error: "too_many_attempts" })
    .where(and(eq(kpi_notifications.status, "pending"), gte(kpi_notifications.attempts, MAX_ATTEMPTS)))
    .returning({ id: kpi_notifications.id });
  const ids = await pendingIds(db, opts.olderThanSec ?? 60, opts.limit ?? 200);
  let queued = 0;
  let skipped = 0;
  let busy = 0;
  for (const id of ids) {
    try {
      const job = await queue.getJob(id);
      if (job) {
        if (LIVE_STATES.has(await job.getState())) {
          busy++;
          continue;
        }
        await queue.remove(id);
      }
      await queue.add(KPI_DELIVER_JOB, { notificationId: id }, { ...deliverJobOptions, jobId: id });
      queued++;
    } catch (e) {
      skipped++;
      console.error("kpi-sweep requeue failed", id, errText(e));
    }
  }
  return { queued, skipped, busy, failed: gaveUp.length };
}
