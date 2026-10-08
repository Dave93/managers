// Очередь снимков книжного количества (spec 2026-10-08, §5): одна задача на пересчёт.
import { Queue } from "bullmq";
import { inventory_counts } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import type { DbLike } from "../access";
import { bookDelayMs } from "./pure";
import { bookTimestamp } from "./service";

export const bookQueueName = () => process.env.INVENTORY_BOOK_QUEUE ?? "inventory_count_book";
// BullMQ не принимает ":" в собственных id задач.
export const bookJobId = (countId: string) => `book-${countId}`;
export type BookJobData = { countId: string };

let queue: Queue | null = null;

export function bookQueue(): Queue {
  queue ??= new Queue(bookQueueName(), {
    connection: { host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT || "6379"), maxRetriesPerRequest: null },
  });
  return queue;
}

export async function closeBookQueue() {
  await queue?.close();
  queue = null;
}

const RUNNING = new Set(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

/** Ставит загрузку снимка; если по этому пересчёту задача уже стоит — ничего не делает. */
export async function enqueueBook(q: Queue, countId: string, delayMs = 0): Promise<{ queued: boolean }> {
  const jobId = bookJobId(countId);
  const existing = await q.getJob(jobId);
  if (existing) {
    if (RUNNING.has(await existing.getState())) return { queued: false };
    await existing.remove();
  }
  await q.add("book", { countId } satisfies BookJobData, {
    jobId,
    // Месячный, отправленный до конца месяца: книжное на 23:58 последнего дня ещё не наступило.
    delay: delayMs,
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
  return { queued: true };
}

/** Ставит снимок с задержкой до момента книжного количества даты пересчёта. */
export async function enqueueBookFor(db: DbLike, countId: string, now = new Date()) {
  const [count] = await db.select({ count_date: inventory_counts.count_date }).from(inventory_counts).where(eq(inventory_counts.id, countId));
  if (!count) return { queued: false };
  return enqueueBook(bookQueue(), countId, bookDelayMs(bookTimestamp(count.count_date), now));
}

/** После отправки пересчёта: снимок — не повод проваливать отправку, если Redis недоступен. */
export async function enqueueBookSafe(db: DbLike, countId: string) {
  try {
    await enqueueBookFor(db, countId);
  } catch (e) {
    console.error(`[inventory/book] enqueue ${countId} failed:`, (e as Error).message);
  }
}
