// Запись уведомлений в kpi_notifications и постановка задач доставки в очередь после коммита; сама доставка идёт в воркере.
import { AsyncLocalStorage } from "node:async_hooks";
import { kpi_notifications } from "backend/drizzle/schema";
import type { DbLike } from "./access";
import { KPI_DELIVER_JOB, deliverJobOptions, getKpiQueue } from "./queue";

export type NotifyInput = {
  recipient_kind: "employee" | "user";
  employee_id?: string;
  user_id?: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

const collector = new AsyncLocalStorage<string[]>();

// Повтор с тем же dedupe_key молча игнорируется и даёт null. Иначе возвращает id
// новой строки и, если вызов идёт внутри collectDeliveries, запоминает его для постановки после коммита.
export async function enqueue(tx: DbLike, n: NotifyInput): Promise<string | null> {
  const rows = await tx
    .insert(kpi_notifications)
    .values({
      recipient_kind: n.recipient_kind,
      employee_id: n.employee_id ?? null,
      user_id: n.user_id ?? null,
      kind: n.kind,
      payload: n.payload,
      dedupe_key: n.dedupe_key,
    })
    .onConflictDoNothing({ target: kpi_notifications.dedupe_key })
    .returning({ id: kpi_notifications.id });
  const id = rows[0]?.id ?? null;
  if (id) collector.getStore()?.push(id);
  return id;
}

// Собирает id, которые enqueue положил за время fn, и ставит задачи только после успешного fn:
// сервис возвращается после transaction(), то есть коммит уже прошёл. При исключении задачи не ставятся.
export async function collectDeliveries<T>(
  fn: () => Promise<T>,
  schedule: (ids: string[]) => void = scheduleDelivery
): Promise<T> {
  const ids: string[] = [];
  const result = await collector.run(ids, fn);
  if (ids.length) schedule(ids);
  return result;
}

// Fire-and-forget, как tickets/queue.ts: при лежащем Redis Queue.add висит минуту и дольше, ждать его в HTTP-пути нельзя.
// Строка уже закоммичена как pending; если постановка не удалась, её подберёт подметалка воркера.
export function scheduleDelivery(ids: string[]): void {
  if (ids.length === 0) return;
  // Коммит уже прошёл: сбой постановки не должен превращать успешный запрос в 500.
  try {
    const q = getKpiQueue();
    for (const id of ids) {
      q.add(KPI_DELIVER_JOB, { notificationId: id }, { ...deliverJobOptions, jobId: id }).catch((e) => {
        console.error("kpi-notify enqueue failed", id, e);
      });
    }
  } catch (e) {
    console.error("kpi-notify enqueue failed", ids, e);
  }
}
