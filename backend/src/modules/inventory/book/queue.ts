// Очередь снимков книжного количества (spec 2026-10-08, §5): одна задача на пересчёт.
import { Queue } from "bullmq";

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
export async function enqueueBook(q: Queue, countId: string): Promise<{ queued: boolean }> {
  const jobId = bookJobId(countId);
  const existing = await q.getJob(jobId);
  if (existing) {
    if (RUNNING.has(await existing.getState())) return { queued: false };
    await existing.remove();
  }
  await q.add("book", { countId } satisfies BookJobData, {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: true,
  });
  return { queued: true };
}

/** После отправки пересчёта: снимок — не повод проваливать отправку, если Redis недоступен. */
export async function enqueueBookSafe(countId: string) {
  try {
    await enqueueBook(bookQueue(), countId);
  } catch (e) {
    console.error(`[inventory/book] enqueue ${countId} failed:`, (e as Error).message);
  }
}
