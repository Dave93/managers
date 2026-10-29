// Сверка по дням: промежуточные пересчёты против книжного количества iiko на конец дня.
// Только товары, по которым филиал ввёл количество. Офис (inventory.reconcile).
import { inventory_count_book_marks, inventory_count_lines } from "backend/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { storeAccess, type Actor, type DbLike } from "../access";
import { storeHasChangeableCount } from "./stock";
import { bookLoadingIds, enqueueBookFor } from "./queue";
import { assertUuid, normalizeNumeric, userNames } from "../counts";
import { InventoryError } from "../errors";
import { round4 } from "../reconcile/pure";
import { interimBookHiddenForBranch, isValidPeriod } from "../rules";
import type { InterimReconDetail, InterimReconLine, InterimReconRow } from "./types";

const EPS = 0.00005;
const q = (x: number) => normalizeNumeric(String(round4(x)));
const n = (x: string | number | null) => (x === null ? "0" : normalizeNumeric(String(x)));

// Строки: введённое количество (не «не считали») + книжное из снимка + отметка.
const LINES_SQL = (countIds: ReturnType<typeof sql>) => sql`
  select l.count_id::text as count_id, l.product_id::text as product_id, l.product_name, l.unit_name, l.group_name,
    l.fact_qty::text as admin_qty, b.book_qty::text as iiko_qty,
    b.start_qty::text as start_qty, b.in_invoice::text as in_invoice, b.out_sales::text as out_sales,
    b.transfer_in::text as transfer_in, b.transfer_out::text as transfer_out, b.out_writeoff::text as out_writeoff,
    b.other_net::text as other_net, coalesce(b.consistent, true) as consistent,
    n.num as code, m.checked_by::text as checked_by, m.checked_at as checked_at,
    c.book_fetched_at is not null as has_book
  from inventory_count_lines l
  join inventory_counts c on c.id = l.count_id
  left join inventory_count_book b on b.count_id = l.count_id and b.product_id = l.product_id
  left join inventory_count_book_marks m on m.count_id = l.count_id and m.product_id = l.product_id
  left join nomenclature_element n on n.id = l.product_id
  where l.count_id in (${countIds}) and not l.skipped and l.fact_qty is not null`;

type RawLine = {
  count_id: string; product_id: string; product_name: string; unit_name: string | null; group_name: string;
  admin_qty: string; iiko_qty: string | null; start_qty: string | null; in_invoice: string | null; out_sales: string | null;
  transfer_in: string | null; transfer_out: string | null; out_writeoff: string | null; other_net: string | null;
  consistent: boolean; code: string | null; checked_by: string | null; checked_at: string | Date | null; has_book: boolean;
};

function toLine(r: RawLine, names: Map<string, string>): InterimReconLine {
  const admin = Number(r.admin_qty);
  const book = r.has_book ? Number(r.iiko_qty ?? 0) : null;
  return {
    product_id: r.product_id,
    code: r.code,
    product_name: r.product_name,
    unit_name: r.unit_name,
    group_name: r.group_name,
    admin_qty: q(admin),
    iiko_qty: book === null ? null : q(book),
    diff_qty: book === null ? null : q(admin - book),
    start_qty: n(r.start_qty),
    in_invoice: n(r.in_invoice),
    out_sales: n(r.out_sales),
    transfer_in: n(r.transfer_in),
    transfer_out: n(r.transfer_out),
    out_writeoff: n(r.out_writeoff),
    other_net: n(r.other_net),
    consistent: r.consistent,
    checked: r.checked_by !== null,
    checked_by_name: r.checked_by ? names.get(r.checked_by) ?? "—" : null,
    checked_at: r.checked_at === null ? null : new Date(r.checked_at).toISOString(),
  };
}

const isMismatch = (l: InterimReconLine) => l.diff_qty !== null && Math.abs(Number(l.diff_qty)) > EPS;

type RawCount = {
  count_id: string; store_id: string; store_name: string | null; count_date: string; template_name: string;
  status: string; book_fetched_at: string | Date | null;
};

type HiddenReason = InterimReconDetail["hidden_reason"];

async function build(db: DbLike, counts: RawCount[], hidden: Map<string, HiddenReason> = new Map()): Promise<InterimReconDetail[]> {
  if (!counts.length) return [];
  // Скрытым пересчётам строки не нужны: цифры iiko филиалу не показываем.
  const visible = counts.filter((c) => !hidden.has(c.count_id));
  const ids = sql.join(visible.map((c) => sql`${c.count_id}::uuid`), sql`, `);
  const raw = visible.length ? ((await db.execute(LINES_SQL(ids))).rows as RawLine[]) : [];
  const names = await userNames(db, raw.map((r) => r.checked_by ?? ""));
  const loading = await bookLoadingIds(counts.map((c) => c.count_id));
  const by = new Map<string, InterimReconLine[]>();
  for (const r of raw) by.set(r.count_id, [...(by.get(r.count_id) ?? []), toLine(r, names)]);
  return counts.map((c) => {
    const lines = (by.get(c.count_id) ?? []).sort(
      (a, b) => a.group_name.localeCompare(b.group_name, "ru") || a.product_name.localeCompare(b.product_name, "ru")
    );
    const mism = lines.filter(isMismatch);
    return {
      count_id: c.count_id,
      store_id: c.store_id,
      store_name: c.store_name ?? "",
      count_date: c.count_date,
      template_name: c.template_name,
      status: c.status,
      book_fetched_at: c.book_fetched_at === null ? null : new Date(c.book_fetched_at).toISOString(),
      lines_counted: lines.length,
      mismatch_count: mism.length,
      checked_count: mism.filter((l) => l.checked).length,
      hidden: hidden.has(c.count_id),
      hidden_reason: hidden.get(c.count_id) ?? null,
      book_loading: loading.has(c.count_id),
      lines,
    };
  });
}

const COUNTS_SQL = sql`
  select c.id::text as count_id, c.store_id::text as store_id, s.name as store_name, c.count_date::text as count_date,
    c.template_name, c.status, c.book_fetched_at
  from inventory_counts c left join corporation_store s on s.id = c.store_id`;

const isOffice = (actor: Actor) => actor.perms.includes("inventory.reconcile");

/** Пересчёты, где филиалу цифры iiko скрыты: дата после 25-го (насовсем) или у склада идёт
 * пересчёт (правило слепого пересчёта, spec 2026-10-08 §6). */
async function hiddenFor(db: DbLike, actor: Actor, counts: RawCount[]): Promise<Map<string, HiddenReason>> {
  const out = new Map<string, HiddenReason>();
  if (isOffice(actor)) return out;
  const changeable = new Set<string>();
  for (const id of new Set(counts.map((c) => c.store_id))) if (await storeHasChangeableCount(db, id)) changeable.add(id);
  for (const c of counts) {
    if (interimBookHiddenForBranch({ kind: "interim", count_date: c.count_date })) out.set(c.count_id, "month_end");
    else if (changeable.has(c.store_id)) out.set(c.count_id, "open_count");
  }
  return out;
}

/** Офис — все склады; филиал — только свои (users_stores), только просмотр. */
export async function listInterimRecons(db: DbLike, actor: Actor, period: string): Promise<InterimReconRow[]> {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  const mine = isOffice(actor)
    ? sql``
    : sql` and c.store_id in (select us.corporation_store_id from users_stores us where us.user_id = ${actor.userId}::uuid)`;
  const counts = (
    await db.execute(sql`${COUNTS_SQL}
      where c.kind = 'interim' and c.period = ${period} and c.status <> 'cancelled'${mine}
      order by c.count_date desc, s.name`)
  ).rows as RawCount[];
  const hidden = await hiddenFor(db, actor, counts);
  return (await build(db, counts, hidden)).map(({ lines: _lines, ...row }) => row);
}

export async function loadInterimRecon(db: DbLike, actor: Actor, countId: string): Promise<InterimReconDetail> {
  assertUuid(countId);
  const counts = (await db.execute(sql`${COUNTS_SQL} where c.id = ${countId}::uuid and c.kind = 'interim'`)).rows as RawCount[];
  if (!counts.length) throw new InventoryError(404, "not_found");
  if (!isOffice(actor) && (await storeAccess(db, actor, counts[0].store_id)) !== "write") {
    throw new InventoryError(403, "store_forbidden");
  }
  const hidden = await hiddenFor(db, actor, counts);
  return (await build(db, counts, hidden))[0];
}

export async function markInterimLine(db: DbLike, countId: string, productId: string, checked: boolean, userId: string) {
  assertUuid(countId);
  assertUuid(productId);
  const [line] = await db
    .select({ id: inventory_count_lines.id })
    .from(inventory_count_lines)
    .where(and(eq(inventory_count_lines.count_id, countId), eq(inventory_count_lines.product_id, productId)));
  if (!line) throw new InventoryError(404, "line_not_found");
  const m = inventory_count_book_marks;
  if (checked) {
    await db.insert(m).values({ count_id: countId, product_id: productId, checked_by: userId }).onConflictDoNothing();
  } else {
    await db.delete(m).where(and(eq(m.count_id, countId), eq(m.product_id, productId)));
  }
  return { ok: true as const };
}

/**
 * «Обновить книжное из iiko» во вкладке «По дням»: снимок заново для всех отправленных промежуточных
 * пересчётов месяца (или одного склада). Задачи — в общую очередь книжного, по одной на пересчёт.
 */
export async function refreshInterimBooks(db: DbLike, period: string, storeId?: string | null) {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  if (storeId) assertUuid(storeId);
  const store = storeId ? sql` and store_id = ${storeId}::uuid` : sql``;
  const rows = (
    await db.execute(sql`select id::text as id from inventory_counts
      where kind = 'interim' and period = ${period} and status = 'submitted'${store}`)
  ).rows as { id: string }[];
  let queued = 0;
  for (const r of rows) if ((await enqueueBookFor(db, r.id)).queued) queued++;
  return { total: rows.length, queued };
}
