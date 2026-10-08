// Видимость книжного количества и «Остатки склада» (spec 2026-10-08, §6).
import { inventory_count_book, inventory_count_lines, inventory_counts } from "backend/drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { storeAccess, type Actor, type DbLike } from "../access";
import { assertUuid, branchMayReopen, GROUP_NAME_SQL, normalizeNumeric } from "../counts";
import { allowedPeriods } from "../rules";
import { InventoryError } from "../errors";
import { round4 } from "../reconcile/pure";
import { withIikoClient, type IikoClient } from "../reconcile/iiko-client";
import { buildBook, type BookLine } from "./pure";
import type { BookLineView, BookView, StockMovement, StockView } from "./types";

// Подменяется в тестах: остатки берутся из iiko прямо при открытии экрана.
type IikoRunner = <T>(fn: (c: IikoClient) => Promise<T>) => Promise<T>;
// Экраны ждут человека: короткий тайм-аут и без повторов (ревью ветки, I4).
let iikoRun: IikoRunner = (fn) => withIikoClient(fn, { timeoutMs: 20_000, retries: 0 });
export function setStockIikoRunner(fn: IikoRunner) {
  iikoRun = fn;
}

const TASHKENT_OFFSET_MS = 5 * 3600_000;
/** Сейчас по Ташкенту, «наивное» местное время iiko. */
function nowLocal(): string {
  return new Date(Date.now() + TASHKENT_OFFSET_MS).toISOString().slice(0, 19);
}

const q = (x: number) => normalizeNumeric(String(round4(x)));
const n = (x: string | null) => (x === null ? null : normalizeNumeric(String(x)));

type ProductInfo = { code: string | null; name: string; unit_name: string | null; group_name: string };

async function productInfo(db: DbLike, ids: string[]): Promise<Map<string, ProductInfo>> {
  const out = new Map<string, ProductInfo>();
  if (!ids.length) return out;
  const res = await db.execute(sql`
    select n.id::text as id, n.num as code, coalesce(n.name, '') as name, mu.name as unit_name, ${GROUP_NAME_SQL} as group_name
    from nomenclature_element n
    left join measure_unit mu on mu.id = n."mainUnit"
    left join nomenclature_group g on g.id = n.parent_id
    left join nomenclature_group gp on gp.id = g.parent_id
    where n.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  for (const r of res.rows as any[]) out.set(r.id, { code: r.code ?? null, name: r.name, unit_name: r.unit_name, group_name: r.group_name });
  return out;
}

/**
 * Есть ли у склада пересчёт, который филиал ещё может менять: черновик или отправленный, который можно вернуть.
 * Только текущий и прошлый месяц — те, в которых пересчёты ведутся (иначе старые периоды без сверки
 * скрывали бы остатки навсегда).
 */
export async function storeHasChangeableCount(db: DbLike, storeId: string, now = new Date()): Promise<boolean> {
  const counts = await db
    .select({ status: inventory_counts.status, store_id: inventory_counts.store_id, period: inventory_counts.period })
    .from(inventory_counts)
    .where(
      and(
        eq(inventory_counts.store_id, storeId),
        inArray(inventory_counts.period, allowedPeriods(now)),
        inArray(inventory_counts.status, ["draft", "submitted"])
      )
    );
  if (counts.some((c) => c.status === "draft")) return true;
  for (const c of counts) if (await branchMayReopen(db, c)) return true;
  return false;
}

/** «Сравнение с учётом»: офис (inventory.reconcile) — всегда; филиал — свой склад и пересчёт зафиксирован. */
export async function loadBook(db: DbLike, actor: Actor, countId: string): Promise<BookView> {
  assertUuid(countId);
  const [count] = await db.select().from(inventory_counts).where(eq(inventory_counts.id, countId));
  if (!count) throw new InventoryError(404, "not_found");
  const office = actor.perms.includes("inventory.reconcile");
  if (!office) {
    if ((await storeAccess(db, actor, count.store_id)) !== "write") throw new InventoryError(403, "store_forbidden");
    if (count.status !== "submitted" || (await branchMayReopen(db, count))) throw new InventoryError(403, "book_hidden");
    // Книжное по складу нельзя видеть, пока другой пересчёт склада ещё открыт для филиала (ревью, C1).
    if (await storeHasChangeableCount(db, count.store_id)) throw new InventoryError(403, "book_hidden");
  }
  if (!count.book_fetched_at) return { fetched_at: null, lines: [] };
  const lines = await db
    .select({
      product_id: inventory_count_lines.product_id,
      product_name: inventory_count_lines.product_name,
      unit_name: inventory_count_lines.unit_name,
      group_name: inventory_count_lines.group_name,
      skipped: inventory_count_lines.skipped,
      fact_qty: inventory_count_lines.fact_qty,
    })
    .from(inventory_count_lines)
    .where(eq(inventory_count_lines.count_id, countId));
  const book = await db.select().from(inventory_count_book).where(eq(inventory_count_book.count_id, countId));
  const lineBy = new Map(lines.map((l) => [l.product_id, l]));
  const bookBy = new Map(book.map((b) => [b.product_id, b]));
  // Филиалу — только позиции его пересчёта; офису — ещё и товары, которые есть лишь в учёте iiko.
  const ids = office ? [...new Set([...lineBy.keys(), ...bookBy.keys()])] : [...lineBy.keys()];
  const info = await productInfo(db, ids);
  const zero = "0";
  const view: BookLineView[] = ids.map((id) => {
    const l = lineBy.get(id);
    const b = bookBy.get(id);
    const meta = info.get(id);
    const fact = l && !l.skipped && l.fact_qty !== null ? Number(l.fact_qty) : null;
    const bookQty = b ? Number(b.book_qty) : 0;
    return {
      product_id: id,
      code: meta?.code ?? null,
      product_name: l?.product_name ?? meta?.name ?? id,
      unit_name: l?.unit_name ?? meta?.unit_name ?? null,
      group_name: l?.group_name ?? meta?.group_name ?? "Без группы",
      in_count: !!l,
      fact_qty: fact === null ? null : q(fact),
      book_qty: q(bookQty),
      diff_qty: fact === null ? null : q(fact - bookQty),
      start_qty: n(b?.start_qty ?? null) ?? zero,
      in_invoice: n(b?.in_invoice ?? null) ?? zero,
      out_sales: n(b?.out_sales ?? null) ?? zero,
      transfer_in: n(b?.transfer_in ?? null) ?? zero,
      transfer_out: n(b?.transfer_out ?? null) ?? zero,
      out_writeoff: n(b?.out_writeoff ?? null) ?? zero,
      other_net: n(b?.other_net ?? null) ?? zero,
      consistent: b?.consistent ?? true,
    };
  });
  return { fetched_at: count.book_fetched_at, lines: view };
}

async function assertStockVisible(db: DbLike, actor: Actor, storeId: string): Promise<boolean> {
  assertUuid(storeId);
  if (actor.perms.includes("inventory.templates")) return true;
  if ((await storeAccess(db, actor, storeId)) !== "write") throw new InventoryError(403, "store_forbidden");
  return !(await storeHasChangeableCount(db, storeId));
}

// Кэш на 2 минуты по складу: каждое открытие экрана иначе — новая сессия iiko (лицензионный слот).
const CACHE_MS = 2 * 60_000;
type Cached<T> = { ts: number; value: T };
const balanceCache = new Map<string, Cached<{ at: string; rows: Awaited<ReturnType<IikoClient["balance"]>> }>>();
const movementCache = new Map<string, Cached<{ from: string; at: string; start: Awaited<ReturnType<IikoClient["balance"]>>; end: Awaited<ReturnType<IikoClient["balance"]>>; movements: Awaited<ReturnType<IikoClient["movements"]>> }>>();
export function clearStockCache() {
  balanceCache.clear();
  movementCache.clear();
}
function fresh<T>(m: Map<string, Cached<T>>, key: string): T | null {
  const c = m.get(key);
  return c && Date.now() - c.ts < CACHE_MS ? c.value : null;
}

export async function loadStock(db: DbLike, actor: Actor, storeId: string): Promise<StockView> {
  if (!(await assertStockVisible(db, actor, storeId))) return { hidden: true, at: null, lines: [] };
  let cached = fresh(balanceCache, storeId);
  if (!cached) {
    const at = nowLocal();
    cached = { at, rows: await iikoRun((c) => c.balance(storeId, at)) };
    balanceCache.set(storeId, { ts: Date.now(), value: cached });
  }
  const at = cached.at;
  const bal = cached.rows.filter((b) => Math.abs(b.amount) > 0.00005);
  const info = await productInfo(db, bal.map((b) => b.product_id));
  const lines = bal
    .map((b) => {
      const m = info.get(b.product_id);
      return { product_id: b.product_id, code: m?.code ?? null, name: m?.name ?? b.product_id, unit_name: m?.unit_name ?? null, group_name: m?.group_name ?? "Без группы", qty: q(b.amount) };
    })
    .sort((x, y) => x.group_name.localeCompare(y.group_name, "ru") || x.name.localeCompare(y.name, "ru"));
  return { hidden: false, at, lines };
}

const breakdown = (l: BookLine) => ({
  start_qty: q(l.start_qty),
  in_invoice: q(l.in_invoice),
  out_sales: q(l.out_sales),
  transfer_in: q(l.transfer_in),
  transfer_out: q(l.transfer_out),
  out_writeoff: q(l.out_writeoff),
  other_net: q(l.other_net),
  consistent: l.consistent,
});

/** Движение товара с 1-го числа текущего месяца по сейчас. */
export async function loadStockMovement(db: DbLike, actor: Actor, storeId: string, productId: string): Promise<StockMovement> {
  assertUuid(productId);
  if (!(await assertStockVisible(db, actor, storeId))) throw new InventoryError(403, "stock_hidden");
  let cached = fresh(movementCache, storeId);
  if (!cached) {
    const at = nowLocal();
    const today = at.slice(0, 10);
    const from = `${today.slice(0, 8)}01`;
    const [start, end, movements] = await iikoRun(async (c) => [
      await c.balance(storeId, `${from}T00:00:00`),
      await c.balance(storeId, at),
      await c.movements(storeId, from, today),
    ] as const);
    cached = { from, at, start, end, movements };
    movementCache.set(storeId, { ts: Date.now(), value: cached });
  }
  const { from, at, start, end, movements } = cached;
  const [line] = buildBook({ productIds: [productId], start, end, movements: movements.filter((m) => m.product_id === productId) });
  return { product_id: productId, from, at, book_qty: q(line.book_qty), ...breakdown(line) };
}
