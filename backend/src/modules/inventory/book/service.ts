// Снимок книжного количества iiko по пересчёту (spec 2026-10-08, §4–5). iiko подаётся снаружи.
import { inventory_count_book, inventory_count_lines, inventory_counts } from "backend/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { InventoryError } from "../errors";
import type { IikoClient } from "../reconcile/iiko-client";
import { lastDayOf } from "../rules";
import { buildBook } from "./pure";

/** Момент книжного: конец дня; в последний день месяца — 23:58, до документа инвентаризации iiko в 23:59. */
export function bookTimestamp(countDate: string): string {
  return lastDayOf(countDate) === countDate ? `${countDate}T23:58:00` : `${countDate}T23:59:59`;
}

const s4 = (x: number) => String(x);

export async function fetchBook(db: DbLike, iiko: IikoClient, countId: string): Promise<{ lines: number; inconsistent: number }> {
  const [count] = await db.select().from(inventory_counts).where(eq(inventory_counts.id, countId));
  if (!count) throw new InventoryError(404, "not_found");
  if (count.status !== "submitted") throw new InventoryError(409, "not_submitted");

  const monthStart = `${count.count_date.slice(0, 8)}01`;
  const start = await iiko.balance(count.store_id, `${monthStart}T00:00:00`);
  const end = await iiko.balance(count.store_id, bookTimestamp(count.count_date));
  const movements = await iiko.movements(count.store_id, monthStart, count.count_date);
  const productIds = (
    await db.select({ product_id: inventory_count_lines.product_id }).from(inventory_count_lines).where(eq(inventory_count_lines.count_id, countId))
  ).map((r) => r.product_id);
  const lines = buildBook({ productIds, start, end, movements });

  await db.transaction(async (tx) => {
    await tx.delete(inventory_count_book).where(eq(inventory_count_book.count_id, countId));
    for (let i = 0; i < lines.length; i += 500) {
      await tx.insert(inventory_count_book).values(
        lines.slice(i, i + 500).map((l) => ({
          count_id: countId,
          product_id: l.product_id,
          book_qty: s4(l.book_qty),
          start_qty: s4(l.start_qty),
          in_invoice: s4(l.in_invoice),
          out_sales: s4(l.out_sales),
          transfer_in: s4(l.transfer_in),
          transfer_out: s4(l.transfer_out),
          out_writeoff: s4(l.out_writeoff),
          other_net: s4(l.other_net),
          consistent: l.consistent,
        }))
      );
    }
    await tx.update(inventory_counts).set({ book_fetched_at: sql`now()` }).where(eq(inventory_counts.id, countId));
  });
  return { lines: lines.length, inconsistent: lines.filter((l) => !l.consistent).length };
}
