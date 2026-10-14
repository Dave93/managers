// Выдача ОСВ (spec 2026-10-14, §7). Офис (inventory.templates) — все склады, количество и суммы.
// Филиал — свой склад (users_stores), только количество, только открытые месяцы (branchMonthState).
import { corporation_store, inventory_counts, inventory_turnover, inventory_turnover_balance, inventory_turnover_fetch } from "backend/drizzle/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { storeAccess, type Actor, type DbLike } from "../access";
import { productInfo } from "../book/stock";
import { assertUuid, branchMayReopen, normalizeNumeric } from "../counts";
import { InventoryError } from "../errors";
import { allowedPeriods, isValidPeriod, lastDayOfMonth } from "../rules";
import { aggregate, branchMonthState, visibleColumns, type Cells, type MonthlyState, type TxAgg } from "./pure";
import { readTurnoverOverview, turnoverQueue } from "./queue";
import type { TurnoverCells, TurnoverLine, TurnoverPeriod, TurnoverStoreView, TurnoverSummary, TurnoverSummaryRow } from "./types";

/** Первый месяц в списке: снимков раньше нет, кнопкой можно загрузить любой из списка. */
const FIRST_PERIOD = "2026-01-31";

export const isOffice = (actor: Actor) => actor.perms.includes("inventory.templates");

const str = (n: number) => normalizeNumeric(n.toFixed(4));
const cells = (c: Cells): TurnoverCells => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, str(v ?? 0)]));

function periodsDesc(now: Date): string[] {
  const out: string[] = [];
  let p = allowedPeriods(now)[0];
  while (p >= FIRST_PERIOD) {
    out.push(p);
    const [y, m] = p.split("-").map(Number);
    p = m === 1 ? lastDayOfMonth(y - 1, 12) : lastDayOfMonth(y, m - 1);
  }
  return out;
}

function assertPeriod(period: string) {
  if (!isValidPeriod(period)) throw new InventoryError(422, "bad_period");
}

/**
 * Месячные пересчёты склада по периодам: есть ли и можно ли ещё изменить (черновик или отправленный,
 * который филиал может вернуть — старые месяцы тоже).
 */
export async function monthlyStates(db: DbLike, storeId: string): Promise<Map<string, MonthlyState>> {
  const counts = await db
    .select({ status: inventory_counts.status, store_id: inventory_counts.store_id, period: inventory_counts.period, kind: inventory_counts.kind })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, storeId), eq(inventory_counts.kind, "monthly"), ne(inventory_counts.status, "cancelled")));
  const out = new Map<string, MonthlyState>();
  for (const c of counts) {
    const cur = out.get(c.period) ?? { exists: true, changeable: false };
    if (!cur.changeable && (c.status === "draft" || (await branchMayReopen(db, c)))) cur.changeable = true;
    out.set(c.period, cur);
  }
  return out;
}

const NO_COUNT: MonthlyState = { exists: false, changeable: false };

/** Филиал: свой склад; иначе 403. */
async function assertBranchStore(db: DbLike, actor: Actor, storeId: string) {
  if ((await storeAccess(db, actor, storeId)) !== "write") throw new InventoryError(403, "forbidden");
}

async function fetchInfo(db: DbLike, period: string | null, storeId?: string) {
  return db
    .select({
      period: inventory_turnover_fetch.period,
      store_id: inventory_turnover_fetch.store_id,
      fetched_at: inventory_turnover_fetch.fetched_at,
      data_through: inventory_turnover_fetch.data_through,
    })
    .from(inventory_turnover_fetch)
    .where(and(period ? eq(inventory_turnover_fetch.period, period) : undefined, storeId ? eq(inventory_turnover_fetch.store_id, storeId) : undefined));
}

export async function listTurnoverPeriods(db: DbLike, actor: Actor, storeId: string | undefined, now: Date): Promise<TurnoverPeriod[]> {
  const office = isOffice(actor);
  if (storeId) assertUuid(storeId);
  if (!office) {
    if (!storeId) throw new InventoryError(422, "store_required");
    await assertBranchStore(db, actor, storeId);
  }
  // Без склада (офис) — самая свежая загрузка по месяцу.
  const byPeriod = new Map<string, { fetched_at: string; data_through: string }>();
  for (const r of await fetchInfo(db, null, storeId)) {
    const cur = byPeriod.get(r.period);
    if (!cur || new Date(cur.fetched_at) < new Date(r.fetched_at)) byPeriod.set(r.period, { fetched_at: r.fetched_at, data_through: r.data_through });
  }
  const states = office ? null : await monthlyStates(db, storeId!);
  return periodsDesc(now).map((period) => {
    const state = states ? branchMonthState(period, now, states.get(period) ?? NO_COUNT) : { open: true, reason: null };
    return { period, ...state, fetched_at: byPeriod.get(period)?.fetched_at ?? null, data_through: byPeriod.get(period)?.data_through ?? null };
  });
}

/** Сводная по складам в суммах — агрегатами SQL: строк немного, даже когда проводок десятки тысяч. */
export async function loadSummary(db: DbLike, redis: Redis, period: string): Promise<TurnoverSummary> {
  assertPeriod(period);
  const txRows = await db
    .select({
      store_id: inventory_turnover.store_id,
      tx_type: inventory_turnover.tx_type,
      sum_in: sql<string>`sum(${inventory_turnover.sum_in})`,
      sum_out: sql<string>`sum(${inventory_turnover.sum_out})`,
    })
    .from(inventory_turnover)
    .where(eq(inventory_turnover.period, period))
    .groupBy(inventory_turnover.store_id, inventory_turnover.tx_type);
  const balRows = await db
    .select({
      store_id: inventory_turnover_balance.store_id,
      start_sum: sql<string>`sum(${inventory_turnover_balance.start_sum})`,
      end_sum: sql<string>`sum(${inventory_turnover_balance.end_sum})`,
      inconsistent: sql<number>`count(*) filter (where not ${inventory_turnover_balance.consistent})::int`,
    })
    .from(inventory_turnover_balance)
    .where(eq(inventory_turnover_balance.period, period))
    .groupBy(inventory_turnover_balance.store_id);

  const txByStore = new Map<string, TxAgg[]>();
  for (const r of txRows) {
    const list = txByStore.get(r.store_id) ?? [];
    // Количество разных товаров не складываем: сводная только в суммах.
    list.push({ tx_type: r.tx_type, qty_in: 0, qty_out: 0, sum_in: Number(r.sum_in), sum_out: Number(r.sum_out) });
    txByStore.set(r.store_id, list);
  }
  const balByStore = new Map(balRows.map((b) => [b.store_id, b]));
  const storeIds = [...new Set([...txByStore.keys(), ...balByStore.keys()])];
  const names = new Map(
    storeIds.length
      ? (await db.select({ id: corporation_store.id, name: corporation_store.name }).from(corporation_store).where(inArray(corporation_store.id, storeIds))).map(
          (s) => [s.id, s.name ?? ""]
        )
      : []
  );
  const info = new Map((await fetchInfo(db, period)).map((r) => [r.store_id, r]));

  const stores = storeIds.map((id) => {
    const b = balByStore.get(id);
    const agg = aggregate({ start_qty: 0, start_sum: Number(b?.start_sum ?? 0), end_qty: 0, end_sum: Number(b?.end_sum ?? 0) }, txByStore.get(id) ?? []);
    return { id, agg: { ...agg, qty: {} }, inconsistent: Number(b?.inconsistent ?? 0) };
  });
  const total: Cells = {};
  for (const s of stores) for (const [k, v] of Object.entries(s.agg.sum)) total[k as keyof Cells] = (total[k as keyof Cells] ?? 0) + (v ?? 0);
  const rows: TurnoverSummaryRow[] = stores
    .map((s) => ({
      store_id: s.id,
      store_name: names.get(s.id) ?? "",
      sum: cells(s.agg.sum),
      inconsistent: s.inconsistent,
      fetched_at: info.get(s.id)?.fetched_at ?? null,
      data_through: info.get(s.id)?.data_through ?? null,
    }))
    .sort((a, b) => a.store_name.localeCompare(b.store_name, "ru"));
  // Сводная только в суммах — sum_only не нужен.
  const columns = visibleColumns(stores.map((s) => s.agg), true).map((c) => ({ key: c.key }));
  return { period, columns, rows, total: cells(total), status: await readTurnoverOverview(redis, period, turnoverQueue()) };
}

export async function loadStoreTurnover(db: DbLike, actor: Actor, period: string, storeId: string, now: Date): Promise<TurnoverStoreView> {
  assertPeriod(period);
  assertUuid(storeId);
  const office = isOffice(actor);
  if (!office) {
    await assertBranchStore(db, actor, storeId);
    const state = branchMonthState(period, now, (await monthlyStates(db, storeId)).get(period) ?? NO_COUNT);
    if (!state.open) throw new InventoryError(403, "month_closed", { reason: state.reason });
  }
  const txs = await db
    .select({
      product_id: inventory_turnover.product_id,
      tx_type: inventory_turnover.tx_type,
      qty_in: inventory_turnover.qty_in,
      qty_out: inventory_turnover.qty_out,
      sum_in: inventory_turnover.sum_in,
      sum_out: inventory_turnover.sum_out,
    })
    .from(inventory_turnover)
    .where(and(eq(inventory_turnover.period, period), eq(inventory_turnover.store_id, storeId)));
  const bals = await db
    .select()
    .from(inventory_turnover_balance)
    .where(and(eq(inventory_turnover_balance.period, period), eq(inventory_turnover_balance.store_id, storeId)));

  const txByProduct = new Map<string, TxAgg[]>();
  for (const t of txs) {
    const list = txByProduct.get(t.product_id) ?? [];
    list.push({ tx_type: t.tx_type, qty_in: Number(t.qty_in), qty_out: Number(t.qty_out), sum_in: Number(t.sum_in), sum_out: Number(t.sum_out) });
    txByProduct.set(t.product_id, list);
  }
  const balByProduct = new Map(bals.map((b) => [b.product_id, b]));
  const ids = [...new Set([...txByProduct.keys(), ...balByProduct.keys()])];
  const info = await productInfo(db, ids);
  const aggs = ids.map((id) => {
    const b = balByProduct.get(id);
    const bal = b && { start_qty: Number(b.start_qty), start_sum: Number(b.start_sum), end_qty: Number(b.end_qty), end_sum: Number(b.end_sum) };
    return { id, agg: aggregate(bal, txByProduct.get(id) ?? []), consistent: b?.consistent ?? false };
  });
  const lines: TurnoverLine[] = aggs
    .map(({ id, agg, consistent }) => {
      const p = info.get(id);
      const qty = { ...agg.qty };
      delete qty.cost_correction;
      const line: TurnoverLine = {
        product_id: id,
        code: p?.code ?? null,
        name: p?.name || id,
        unit_name: p?.unit_name ?? null,
        group_name: p?.group_name ?? "Без группы",
        qty: cells(qty),
        transfer: { qty_in: str(agg.transfer.qty_in), qty_out: str(agg.transfer.qty_out) },
        consistent,
      };
      // Суммы — только офису: филиалу ключей нет вовсе (spec 2026-10-14, решение 2).
      if (office) {
        line.sum = cells(agg.sum);
        line.transfer.sum_in = str(agg.transfer.sum_in);
        line.transfer.sum_out = str(agg.transfer.sum_out);
      }
      return line;
    })
    .sort((a, b) => a.group_name.localeCompare(b.group_name, "ru") || a.name.localeCompare(b.name, "ru"));
  const [store] = await db.select({ name: corporation_store.name }).from(corporation_store).where(eq(corporation_store.id, storeId));
  const [fetch] = await fetchInfo(db, period, storeId);
  return {
    period,
    store_id: storeId,
    store_name: store?.name ?? "",
    with_sums: office,
    columns: visibleColumns(
      aggs.map((a) => a.agg),
      office
    ),
    lines,
    fetched_at: fetch?.fetched_at ?? null,
    data_through: fetch?.data_through ?? null,
  };
}
