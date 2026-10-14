// Загрузка снимка ОСВ из iiko (spec 2026-10-14, §6). Склады — по одному: OLAP по всем складам
// идёт ~100 с, по складу ~4 с, и сбой одного склада не теряет остальные.
import { corporation_store, inventory_turnover, inventory_turnover_balance, inventory_turnover_fetch } from "backend/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import type { TurnoverSource } from "../reconcile/iiko-client";
import { buildStoreSnapshot, turnoverBounds, type IikoBal, type IikoTx } from "./pure";
import type { TurnoverFetchStatus } from "./types";

type Progress = (p: Partial<TurnoverFetchStatus>) => Promise<void>;

const CHUNK = 1000;
const q4 = (n: number) => n.toFixed(4);

async function writeStoreSnapshot(db: DbLike, period: string, storeId: string, dataThrough: string, start: IikoBal[], end: IikoBal[], txs: IikoTx[]) {
  const snap = buildStoreSnapshot(storeId, start, end, txs);
  await db.transaction(async (tx) => {
    const where = (t: typeof inventory_turnover | typeof inventory_turnover_balance) => and(eq(t.period, period), eq(t.store_id, storeId));
    await tx.delete(inventory_turnover).where(where(inventory_turnover));
    await tx.delete(inventory_turnover_balance).where(where(inventory_turnover_balance));
    // Одна строка на товар × тип: OLAP группирует по ним, но на всякий случай сводим.
    const byKey = new Map<string, IikoTx>();
    for (const t of snap.turnover) {
      const k = `${t.product_id}|${t.type}`;
      const cur = byKey.get(k);
      byKey.set(k, cur ? { ...cur, qty_in: cur.qty_in + t.qty_in, qty_out: cur.qty_out + t.qty_out, sum_in: cur.sum_in + t.sum_in, sum_out: cur.sum_out + t.sum_out } : t);
    }
    const turnoverRows = [...byKey.values()].map((t) => ({
      period, store_id: storeId, product_id: t.product_id, tx_type: t.type.slice(0, 40),
      qty_in: q4(t.qty_in), qty_out: q4(t.qty_out), sum_in: q4(t.sum_in), sum_out: q4(t.sum_out),
    }));
    for (let i = 0; i < turnoverRows.length; i += CHUNK) await tx.insert(inventory_turnover).values(turnoverRows.slice(i, i + CHUNK));
    const balanceRows = snap.balances.map((b) => ({
      period, store_id: storeId, product_id: b.product_id,
      start_qty: q4(b.start_qty), start_sum: q4(b.start_sum), end_qty: q4(b.end_qty), end_sum: q4(b.end_sum), consistent: b.consistent,
    }));
    for (let i = 0; i < balanceRows.length; i += CHUNK) await tx.insert(inventory_turnover_balance).values(balanceRows.slice(i, i + CHUNK));
    await tx
      .insert(inventory_turnover_fetch)
      .values({ period, store_id: storeId, data_through: dataThrough })
      .onConflictDoUpdate({
        target: [inventory_turnover_fetch.period, inventory_turnover_fetch.store_id],
        set: { fetched_at: sql`now()`, data_through: dataThrough },
      });
  });
}

export async function fetchTurnover(
  db: DbLike,
  iiko: TurnoverSource,
  input: { period: string; storeId: string | null },
  progress: Progress = async () => {},
  now = new Date()
): Promise<{ stores: number; failed: string[] }> {
  const startedAt = new Date().toISOString();
  const bounds = turnoverBounds(input.period, now);
  if (!bounds) {
    await progress({ state: "done", total: 0, done: 0, failed: [], started_at: startedAt, finished_at: new Date().toISOString() });
    return { stores: 0, failed: [] };
  }
  const start = await iiko.balances(bounds.startAt, input.storeId ?? undefined);
  const end = await iiko.balances(bounds.endAt, input.storeId ?? undefined);
  let stores: string[];
  if (input.storeId) stores = [input.storeId];
  else {
    // Склад с движением, но нулевыми остатками на начало и конец, есть только в corporation_store.
    const known = await db.select({ id: corporation_store.id }).from(corporation_store);
    stores = [...new Set([...start.map((b) => b.store_id), ...end.map((b) => b.store_id), ...known.map((k) => k.id)])].sort();
  }
  await progress({ state: "running", total: stores.length, done: 0, failed: [], started_at: startedAt });
  const failed: string[] = [];
  for (let i = 0; i < stores.length; i++) {
    const storeId = stores[i];
    try {
      const txs = await iiko.turnover(storeId, bounds.from, bounds.to);
      await writeStoreSnapshot(db, input.period, storeId, bounds.to, start, end, txs);
    } catch (e) {
      console.error(`[turnover] ${input.period} ${storeId} failed:`, (e as Error).message);
      failed.push(storeId);
    }
    await progress({ done: i + 1, failed });
  }
  await progress({ state: "done", finished_at: new Date().toISOString(), failed });
  return { stores: stores.length, failed };
}
