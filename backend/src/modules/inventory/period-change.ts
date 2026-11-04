// Офис переносит месячный пересчёт в другой месяц (04.11.2026): в начале ноября филиалы отправили
// октябрьский пересчёт как ноябрьский. Отдельный файл: counts.ts ⇄ reconcile/service.ts иначе
// замкнулись бы друг на друга.
import { inventory_count_book, inventory_count_book_marks, inventory_counts, inventory_reconciliations } from "backend/drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDB } from "@backend/lib/db";
import type { Actor } from "./access";
import { enqueueBookFor } from "./book/queue";
import { findActive, isUniqueViolation, lockCount, writeEvent } from "./counts";
import { InventoryError } from "./errors";
import { refreshStorePeriods } from "./reconcile/service";
import { periodTargets } from "./rules";

export async function changeCountPeriod(db: DrizzleDB, actor: Actor, id: string, period: string, now: Date) {
  if (!actor.perms.includes("inventory.reconcile")) throw new InventoryError(403, "forbidden");
  let moved: { store_id: string; from: string; status: string };
  try {
    moved = await db.transaction(async (tx) => {
      const row = await lockCount(tx, id);
      if (row.kind !== "monthly") throw new InventoryError(422, "not_monthly");
      if (row.status === "cancelled") throw new InventoryError(409, "cancelled");
      const targets = periodTargets(row, actor.perms, now);
      if (!targets.includes(period)) throw new InventoryError(422, "invalid_period", { allowed: targets });
      // Принятая сверка — месяц закрыт: перенос молча поменял бы её итоги.
      const [closed] = await tx
        .select({ period: inventory_reconciliations.period })
        .from(inventory_reconciliations)
        .where(
          and(
            eq(inventory_reconciliations.store_id, row.store_id),
            inArray(inventory_reconciliations.period, [row.period, period]),
            eq(inventory_reconciliations.status, "accepted")
          )
        );
      if (closed) throw new InventoryError(409, "period_closed", { period: closed.period });
      // У месячного count_date = period, по нему же ищется дубль и грузится книжное iiko.
      const taken = await findActive(tx, row.store_id, "monthly", period, row.template_id);
      if (taken) throw new InventoryError(409, "period_taken", { count_id: taken.id });
      await tx
        .update(inventory_counts)
        .set({ period, count_date: period, book_fetched_at: null, updated_at: sql`now()` })
        .where(eq(inventory_counts.id, id));
      // Книжное было на конец старого месяца — сравнивать с ним уже нельзя.
      await tx.delete(inventory_count_book_marks).where(eq(inventory_count_book_marks.count_id, id));
      await tx.delete(inventory_count_book).where(eq(inventory_count_book.count_id, id));
      await writeEvent(tx, id, "period_changed", actor.userId, { from: row.period, to: period });
      return { store_id: row.store_id, from: row.period, status: row.status };
    });
  } catch (e) {
    // Гонка с «Начать» филиала на тот же месяц: частичный уникальный индекс отбил перенос.
    if (isUniqueViolation(e)) throw new InventoryError(409, "period_taken");
    throw e;
  }
  // Перенос уже записан: сбой пересчёта сверки или очереди не повод отвечать ошибкой.
  try {
    await refreshStorePeriods(db, moved.store_id, [moved.from, period]);
  } catch (e) {
    console.error(`[inventory/period] recon refresh ${id} failed:`, (e as Error).message);
  }
  // Снимок книжного на новую дату. Задачу, отложенную до конца старого месяца, заменяем.
  if (moved.status === "submitted") {
    try {
      await enqueueBookFor(db, id, now, true);
    } catch (e) {
      console.error(`[inventory/period] book enqueue ${id} failed:`, (e as Error).message);
    }
  }
  return { ok: true as const, period };
}
