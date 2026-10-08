import {
  corporation_store,
  inventory_count_entries,
  inventory_count_events,
  inventory_count_lines,
  inventory_counts,
  inventory_template_items,
  inventory_templates,
  nomenclature_element,
  organization,
  users,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type Redis from "ioredis";
import type { DrizzleDB } from "@backend/lib/db";
import { canManage, storeAccess, type Actor, type DbLike } from "./access";
import { storeProductIds } from "./branch-products";
import { InventoryError } from "./errors";
import { allowedPeriods, isValidQty, nextStatus, UUID_RE } from "./rules";
import type {
  InventoryAvailableTemplate,
  InventoryStartOptions,
  InventoryCountDetail,
  InventoryCountStatus,
  InventoryCountSummary,
  InventoryEntry,
  InventoryLine,
  InventoryProduct,
  InventorySyncOp,
  InventorySyncResult,
  InventoryTemplateSummary,
} from "./types";

type CountRow = typeof inventory_counts.$inferSelect;

export function assertUuid(id: string) {
  if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
}

export async function lockCount(tx: DbLike, id: string): Promise<CountRow> {
  assertUuid(id);
  const rows = await tx.select().from(inventory_counts).where(eq(inventory_counts.id, id)).for("update");
  if (!rows.length) throw new InventoryError(404, "not_found");
  return rows[0];
}

export async function writeEvent(tx: DbLike, countId: string, type: string, userId: string, payload?: unknown) {
  await tx.insert(inventory_count_events).values({ count_id: countId, type, user_id: userId, payload: payload ?? null });
}

export async function userNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const rows = await db
    .select({ id: users.id, first_name: users.first_name, last_name: users.last_name, login: users.login })
    .from(users)
    .where(inArray(users.id, uniq));
  for (const r of rows) {
    const full = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    out.set(r.id, full || r.login);
  }
  for (const id of uniq) if (!out.has(id)) out.set(id, "—");
  return out;
}

// Drizzle в select-полях пишет колонку без имени таблицы ("id"), и внутри
// коррелированного подзапроса такое "id" связывается с таблицей подзапроса.
// Поэтому внешние колонки в подзапросах — только явными квалифицированными ссылками.
export const LINE_ID = sql.raw(`"inventory_count_lines"."id"`);
export const TEMPLATE_ID = sql.raw(`"inventory_templates"."id"`);

// Снимок строки: название, единица, папка iiko «Родитель / Папка».
export const GROUP_NAME_SQL = sql.raw(
  `case when g.id is null then 'Без группы' when gp.name is null then g.name else gp.name || ' / ' || g.name end`
);

export async function availableTemplates(
  db: DbLike,
  redis: Redis,
  actor: Actor,
  storeId: string
): Promise<InventoryStartOptions> {
  assertUuid(storeId);
  const access = await storeAccess(db, actor, storeId);
  if (access === "none") throw new InventoryError(403, "store_forbidden");
  const [store] = await db.select().from(corporation_store).where(eq(corporation_store.id, storeId));
  if (!store) throw new InventoryError(404, "store_not_found");
  const where = [eq(inventory_templates.active, true)];
  // Склад без организации (новые филиалы) видит все активные шаблоны.
  if (store.organization_id) where.push(eq(inventory_templates.organization_id, store.organization_id));
  const rows = await db
    .select({
      id: inventory_templates.id,
      organization_id: inventory_templates.organization_id,
      organization_name: organization.name,
      name: inventory_templates.name,
      active: inventory_templates.active,
      sort: inventory_templates.sort,
      items_count: sql<number>`(select count(*)::int from inventory_template_items ti where ti.template_id = ${TEMPLATE_ID})`,
    })
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(and(...where))
    .orderBy(asc(inventory_templates.sort), asc(inventory_templates.name));

  // Сколько позиций каждого шаблона попадёт в пересчёт этого склада: те же
  // правила, что при создании (товар есть в номенклатуре и, если есть exord, в филиале).
  const branch = await storeProductIds(redis, db as DrizzleDB, storeId);
  const branchSet = branch ? new Set(branch) : null;
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({ template_id: inventory_template_items.template_id, product_id: inventory_template_items.product_id })
        .from(inventory_template_items)
        .innerJoin(nomenclature_element, eq(nomenclature_element.id, inventory_template_items.product_id))
        .where(inArray(inventory_template_items.template_id, ids))
    : [];
  const forStore = new Map<string, number>();
  for (const it of items) {
    if (branchSet && !branchSet.has(it.product_id)) continue;
    forStore.set(it.template_id, (forStore.get(it.template_id) ?? 0) + 1);
  }
  const templates = rows.map((r) => ({
    ...r,
    organization_name: r.organization_name ?? null,
    items_for_store: forStore.get(r.id) ?? 0,
    exord_filtered: branch !== null,
  }));
  const branchItems = branch
    ? (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(nomenclature_element)
          .where(sql`${nomenclature_element.id} in (${uuidList(branch)})`)
      )[0].n
    : 0;
  return { branch: { available: branch !== null, items_for_store: branchItems }, templates };
}

export const BRANCH_COUNT_NAME = "Все товары филиала";

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

// Условие «товар из списка филиала» для INSERT ... SELECT по шаблону.
function branchFilter(ids: string[] | null) {
  if (ids === null) return sql``;
  if (ids.length === 0) return sql` and false`;
  return sql` and ti.product_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;
}

function isUniqueViolation(e: any): boolean {
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function findActive(db: DbLike, storeId: string, period: string, templateId: string | null) {
  const [row] = await db
    .select({ id: inventory_counts.id })
    .from(inventory_counts)
    .where(
      and(
        eq(inventory_counts.store_id, storeId),
        eq(inventory_counts.period, period),
        templateId ? eq(inventory_counts.template_id, templateId) : isNull(inventory_counts.template_id),
        ne(inventory_counts.status, "cancelled")
      )
    );
  return row ?? null;
}

// template_id не задан — «Все товары филиала»: строки = список филиала из exord
// (только товары, которые есть в номенклатуре). Без exord такой пересчёт не имеет смысла.
export async function createCount(
  db: DbLike,
  redis: Redis,
  actor: Actor,
  input: { store_id: string; template_id?: string; period: string },
  now: Date
): Promise<{ id: string; existing: boolean }> {
  assertUuid(input.store_id);
  if (input.template_id !== undefined) assertUuid(input.template_id);
  const templateId = input.template_id ?? null;
  const access = await storeAccess(db, actor, input.store_id);
  if (!canManage(actor, access)) throw new InventoryError(403, "forbidden");
  if (!allowedPeriods(now).includes(input.period)) {
    throw new InventoryError(422, "invalid_period", { allowed: allowedPeriods(now) });
  }
  const [store] = await db.select().from(corporation_store).where(eq(corporation_store.id, input.store_id));
  if (!store) throw new InventoryError(404, "store_not_found");
  let tpl: typeof inventory_templates.$inferSelect | null = null;
  if (templateId) {
    const [row] = await db.select().from(inventory_templates).where(eq(inventory_templates.id, templateId));
    if (!row || !row.active) throw new InventoryError(422, "template_unavailable");
    if (store.organization_id && store.organization_id !== row.organization_id) {
      throw new InventoryError(422, "template_unavailable");
    }
    tpl = row;
  }

  const existing = await findActive(db, input.store_id, input.period, templateId);
  if (existing) return { id: existing.id, existing: true };
  const branch = await storeProductIds(redis, db as DrizzleDB, input.store_id);
  if (!tpl && !branch) throw new InventoryError(422, "no_branch_products");

  const lineSource = tpl
    ? sql`from inventory_template_items ti
        join nomenclature_element n on n.id = ti.product_id
        left join measure_unit mu on mu.id = n."mainUnit"
        left join nomenclature_group g on g.id = n.parent_id
        left join nomenclature_group gp on gp.id = g.parent_id
        where ti.template_id = ${tpl.id}${branchFilter(branch)}`
    : sql`from nomenclature_element n
        left join measure_unit mu on mu.id = n."mainUnit"
        left join nomenclature_group g on g.id = n.parent_id
        left join nomenclature_group gp on gp.id = g.parent_id
        where n.id in (${uuidList(branch!)})`;

  try {
    const id = await db.transaction(async (tx) => {
      const [count] = await tx
        .insert(inventory_counts)
        .values({
          store_id: input.store_id,
          organization_id: store.organization_id ?? tpl?.organization_id ?? null,
          template_id: tpl?.id ?? null,
          template_name: tpl?.name ?? BRANCH_COUNT_NAME,
          period: input.period,
          status: "draft",
          exord_filtered: branch !== null,
          created_by: actor.userId,
        })
        .returning({ id: inventory_counts.id });
      await tx.execute(sql`
        insert into inventory_count_lines (count_id, product_id, product_name, unit_id, unit_name, group_id, group_name, source)
        select ${count.id}, n.id, coalesce(n.name, ''), n."mainUnit", mu.name, g.id, ${GROUP_NAME_SQL}, 'template'
        ${lineSource}
      `);
      await writeEvent(tx, count.id, "created", actor.userId, {
        template_id: tpl?.id ?? null,
        period: input.period,
        exord_filtered: branch !== null,
      });
      return count.id;
    });
    return { id, existing: false };
  } catch (e) {
    // Гонка двух «Начать»: частичный уникальный индекс отбил вторую вставку.
    if (isUniqueViolation(e)) {
      const row = await findActive(db, input.store_id, input.period, templateId);
      if (row) return { id: row.id, existing: true };
    }
    throw e;
  }
}

type SummaryBase = Pick<
  CountRow,
  "id" | "store_id" | "template_id" | "template_name" | "period" | "status" | "exord_filtered" | "created_at" | "submitted_at" | "submitted_by"
> & { store_name: string | null };

const summaryColumns = {
  id: inventory_counts.id,
  store_id: inventory_counts.store_id,
  template_id: inventory_counts.template_id,
  template_name: inventory_counts.template_name,
  period: inventory_counts.period,
  status: inventory_counts.status,
  exord_filtered: inventory_counts.exord_filtered,
  created_at: inventory_counts.created_at,
  submitted_at: inventory_counts.submitted_at,
  submitted_by: inventory_counts.submitted_by,
  store_name: corporation_store.name,
};

export async function summaries(db: DbLike, rows: SummaryBase[]): Promise<InventoryCountSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const l = inventory_count_lines;
  const progress = await db
    .select({
      count_id: l.count_id,
      total: sql<number>`count(*)::int`,
      done: sql<number>`(count(*) filter (where ${l.skipped} or exists (select 1 from inventory_count_entries e where e.line_id = ${LINE_ID} and e.deleted_at is null)))::int`,
    })
    .from(l)
    .where(inArray(l.count_id, ids))
    .groupBy(l.count_id);
  const progressBy = new Map(progress.map((p) => [p.count_id, p]));

  const parts = await db
    .selectDistinct({ count_id: inventory_count_entries.count_id, user_id: inventory_count_entries.created_by })
    .from(inventory_count_entries)
    .where(and(inArray(inventory_count_entries.count_id, ids), isNull(inventory_count_entries.deleted_at)));
  const names = await userNames(db, [...parts.map((p) => p.user_id), ...rows.map((r) => r.submitted_by ?? "")]);
  const partsBy = new Map<string, string[]>();
  for (const p of parts) {
    const list = partsBy.get(p.count_id) ?? [];
    list.push(names.get(p.user_id) ?? "—");
    partsBy.set(p.count_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    store_id: r.store_id,
    store_name: r.store_name ?? "",
    template_id: r.template_id,
    template_name: r.template_name,
    period: r.period,
    status: r.status as InventoryCountStatus,
    exord_filtered: r.exord_filtered,
    created_at: r.created_at,
    submitted_at: r.submitted_at,
    submitted_by_name: r.submitted_by ? names.get(r.submitted_by) ?? "—" : null,
    lines_total: progressBy.get(r.id)?.total ?? 0,
    lines_done: progressBy.get(r.id)?.done ?? 0,
    participants: (partsBy.get(r.id) ?? []).sort(),
  }));
}

export async function listCounts(db: DbLike, actor: Actor, storeId: string): Promise<InventoryCountSummary[]> {
  assertUuid(storeId);
  if ((await storeAccess(db, actor, storeId)) === "none") throw new InventoryError(403, "store_forbidden");
  const rows = await db
    .select(summaryColumns)
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(and(eq(inventory_counts.store_id, storeId), ne(inventory_counts.status, "cancelled")))
    .orderBy(desc(inventory_counts.period), asc(inventory_counts.template_name));
  return summaries(db, rows);
}

export async function loadCount(db: DbLike, actor: Actor, id: string, now: Date): Promise<InventoryCountDetail> {
  assertUuid(id);
  const [row] = await db
    .select(summaryColumns)
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(eq(inventory_counts.id, id));
  if (!row) throw new InventoryError(404, "not_found");
  const access = await storeAccess(db, actor, row.store_id);
  if (access === "none") throw new InventoryError(403, "store_forbidden");

  const [summary] = await summaries(db, [row]);
  const l = inventory_count_lines;
  const lines = await db
    .select({
      id: l.id,
      product_id: l.product_id,
      product_name: l.product_name,
      unit_name: l.unit_name,
      group_id: l.group_id,
      group_name: l.group_name,
      source: l.source,
      skipped: l.skipped,
      fact_qty: l.fact_qty,
      total: sql<string>`coalesce((select sum(e.qty) from inventory_count_entries e where e.line_id = ${LINE_ID} and e.deleted_at is null), 0)::text`,
    })
    .from(l)
    .where(eq(l.count_id, id))
    .orderBy(asc(l.group_name), asc(l.product_name));

  const e = inventory_count_entries;
  const entries = await db
    .select({ id: e.id, line_id: e.line_id, qty: e.qty, created_by: e.created_by, client_created_at: e.client_created_at })
    .from(e)
    .where(and(eq(e.count_id, id), isNull(e.deleted_at)))
    .orderBy(asc(e.client_created_at));
  const names = await userNames(db, entries.map((x) => x.created_by));
  const entriesBy = new Map<string, InventoryEntry[]>();
  for (const x of entries) {
    const list = entriesBy.get(x.line_id) ?? [];
    list.push({ ...x, qty: String(x.qty), created_by_name: names.get(x.created_by) ?? "—" });
    entriesBy.set(x.line_id, list);
  }

  const manage = canManage(actor, access);
  return {
    ...summary,
    viewer_id: actor.userId,
    access,
    can_manage: manage,
    // Отправленный пересчёт филиал уже не меняет: вернуть в черновик может только офис.
    can_reopen: row.status === "submitted" && canReopen(actor),
    lines: lines.map(
      (x): InventoryLine => ({
        ...x,
        source: x.source as InventoryLine["source"],
        fact_qty: x.fact_qty === null ? null : String(x.fact_qty),
        total: normalizeNumeric(x.total),
        entries: entriesBy.get(x.id) ?? [],
      })
    ),
  };
}

// "5.5000" → "5.5", "0.0000" → "0": numeric из sum() приходит с хвостом нулей.
export function normalizeNumeric(v: string): string {
  if (!v.includes(".")) return v;
  return v.replace(/\.?0+$/, "") || "0";
}

export async function requireWritableDraft(tx: DbLike, actor: Actor, id: string) {
  const row = await lockCount(tx, id);
  const access = await storeAccess(tx, actor, row.store_id);
  if (access !== "write") throw new InventoryError(403, "store_forbidden");
  if (row.status !== "draft") throw new InventoryError(409, "not_draft", { status: row.status });
  return { row, manage: canManage(actor, access) };
}

export async function syncEntries(db: DbLike, actor: Actor, id: string, ops: InventorySyncOp[]): Promise<InventorySyncResult> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: submit ждёт конца этой пачки, поэтому принятая запись
    // всегда попадает в fact_qty, а пачка после submit получает 409.
    const { manage } = await requireWritableDraft(tx, actor, id);
    const lineRows = await tx
      .select({ id: inventory_count_lines.id })
      .from(inventory_count_lines)
      .where(eq(inventory_count_lines.count_id, id));
    const lineIds = new Set(lineRows.map((r) => r.id));
    const result: InventorySyncResult = { applied: [], rejected: [] };

    for (const op of ops) {
      if (!UUID_RE.test(op.id)) {
        result.rejected.push({ id: op.id, reason: "invalid_id" });
        continue;
      }
      if (op.op === "add") {
        if (!isValidQty(op.qty)) {
          result.rejected.push({ id: op.id, reason: "invalid_qty" });
          continue;
        }
        if (!lineIds.has(op.line_id)) {
          result.rejected.push({ id: op.id, reason: "not_found_line" });
          continue;
        }
        const clientAt = Number.isNaN(Date.parse(op.client_created_at)) ? new Date().toISOString() : op.client_created_at;
        await tx
          .insert(inventory_count_entries)
          .values({
            id: op.id,
            count_id: id,
            line_id: op.line_id,
            qty: String(op.qty),
            created_by: actor.userId,
            client_created_at: clientAt,
          })
          .onConflictDoNothing({ target: inventory_count_entries.id });
        result.applied.push(op.id);
      } else {
        const [entry] = await tx
          .select()
          .from(inventory_count_entries)
          .where(and(eq(inventory_count_entries.id, op.id), eq(inventory_count_entries.count_id, id)));
        if (!entry || entry.deleted_at) {
          result.applied.push(op.id);
          continue;
        }
        if (entry.created_by !== actor.userId && !manage) {
          result.rejected.push({ id: op.id, reason: "forbidden" });
          continue;
        }
        await tx
          .update(inventory_count_entries)
          .set({ deleted_at: sql`now()`, deleted_by: actor.userId })
          .where(eq(inventory_count_entries.id, op.id));
        result.applied.push(op.id);
      }
    }
    return result;
  });
}

// Добавить можно любой товар номенклатуры: на складе бывает то, что филиал
// берёт мимо exord (решение 15 в §13 спеки). Офис видит такие позиции в
// подсказках шаблона.
export async function addLine(db: DbLike, actor: Actor, id: string, productId: string) {
  assertUuid(productId);
  return db.transaction(async (tx) => {
    await requireWritableDraft(tx, actor, id);
    const inserted = await tx.execute(sql`
      insert into inventory_count_lines (count_id, product_id, product_name, unit_id, unit_name, group_id, group_name, source, added_by)
      select ${id}, n.id, coalesce(n.name, ''), n."mainUnit", mu.name, g.id, ${GROUP_NAME_SQL}, 'added', ${actor.userId}
      from nomenclature_element n
      left join measure_unit mu on mu.id = n."mainUnit"
      left join nomenclature_group g on g.id = n.parent_id
      left join nomenclature_group gp on gp.id = g.parent_id
      where n.id = ${productId} and coalesce(n.deleted, false) = false
      on conflict (count_id, product_id) do nothing
      returning id
    `);
    const newId = (inserted.rows[0] as { id: string } | undefined)?.id;
    if (newId) {
      await writeEvent(tx, id, "line_added", actor.userId, { product_id: productId });
      return { line_id: newId, created: true };
    }
    const [existing] = await tx
      .select({ id: inventory_count_lines.id })
      .from(inventory_count_lines)
      .where(and(eq(inventory_count_lines.count_id, id), eq(inventory_count_lines.product_id, productId)));
    if (!existing) throw new InventoryError(404, "product_not_found");
    return { line_id: existing.id, created: false };
  });
}

export async function setSkipped(db: DbLike, actor: Actor, id: string, lineId: string, skipped: boolean) {
  assertUuid(lineId);
  return db.transaction(async (tx) => {
    await requireWritableDraft(tx, actor, id);
    const updated = await tx
      .update(inventory_count_lines)
      .set({ skipped, skipped_by: skipped ? actor.userId : null })
      .where(and(eq(inventory_count_lines.id, lineId), eq(inventory_count_lines.count_id, id)))
      .returning({ id: inventory_count_lines.id });
    if (!updated.length) throw new InventoryError(404, "line_not_found");
    return { ok: true as const };
  });
}

export type ProductScope = { branch?: string[]; exclude?: string[] };

// Для «+ товар не из списка»: без уже посчитанных позиций; в инвентаризации с
// фильтром exord товары филиала идут первыми и помечены in_branch.
export async function productScope(db: DbLike, redis: Redis, actor: Actor, countId: string): Promise<ProductScope> {
  assertUuid(countId);
  const [row] = await db
    .select({ store_id: inventory_counts.store_id, exord_filtered: inventory_counts.exord_filtered })
    .from(inventory_counts)
    .where(eq(inventory_counts.id, countId));
  if (!row) throw new InventoryError(404, "not_found");
  if ((await storeAccess(db, actor, row.store_id)) === "none") throw new InventoryError(403, "store_forbidden");
  const existing = await db
    .select({ product_id: inventory_count_lines.product_id })
    .from(inventory_count_lines)
    .where(eq(inventory_count_lines.count_id, countId));
  const exclude = existing.map((e) => e.product_id);
  if (!row.exord_filtered) return { exclude };
  const branch = await storeProductIds(redis, db as DrizzleDB, row.store_id);
  return branch ? { branch, exclude } : { exclude };
}

export async function searchProducts(db: DbLike, q: string, limit: number, scope: ProductScope = {}) {
  const term = q.trim();
  if (term.length < 2) return [];
  const inBranch = scope.branch ? sql`(n.id in (${uuidList(scope.branch)}))` : sql`null::boolean`;
  const branchFirst = scope.branch ? sql`${inBranch} desc, ` : sql``;
  const excludeF = scope.exclude?.length ? sql` and n.id not in (${uuidList(scope.exclude)})` : sql``;
  const rows = await db.execute(sql`
    select n.id, coalesce(n.name, '') as name, mu.name as unit_name, ${GROUP_NAME_SQL} as group_name,
      ${inBranch} as in_branch
    from nomenclature_element n
    left join measure_unit mu on mu.id = n."mainUnit"
    left join nomenclature_group g on g.id = n.parent_id
    left join nomenclature_group gp on gp.id = g.parent_id
    where coalesce(n.deleted, false) = false
      and n.type in ('GOODS', 'PREPARED')
      and n.name ilike ${"%" + term + "%"}${excludeF}
    order by ${branchFirst}n.name
    limit ${Math.min(Math.max(limit, 1), 50)}
  `);
  return rows.rows as unknown as InventoryProduct[];
}

async function requireManagedCount(tx: DbLike, actor: Actor, id: string) {
  const row = await lockCount(tx, id);
  const access = await storeAccess(tx, actor, row.store_id);
  if (access === "none") throw new InventoryError(403, "store_forbidden");
  if (!canManage(actor, access)) throw new InventoryError(403, "forbidden");
  return row;
}

export async function submitCount(db: DbLike, actor: Actor, id: string, skipIncomplete: boolean) {
  return db.transaction(async (tx) => {
    const row = await requireManagedCount(tx, actor, id);
    const to = nextStatus("submit", row.status);
    if (!to) throw new InventoryError(409, "not_draft", { status: row.status });

    const l = inventory_count_lines;
    const incomplete = await tx
      .select({ id: l.id })
      .from(l)
      .where(
        and(
          eq(l.count_id, id),
          eq(l.skipped, false),
          sql`not exists (select 1 from inventory_count_entries e where e.line_id = ${LINE_ID} and e.deleted_at is null)`
        )
      );
    if (incomplete.length && !skipIncomplete) {
      throw new InventoryError(422, "incomplete", { incomplete: incomplete.length });
    }
    if (incomplete.length) {
      await tx
        .update(l)
        .set({ skipped: true, skipped_by: actor.userId })
        .where(inArray(l.id, incomplete.map((x) => x.id)));
    }
    // Итог фиксируется в SQL: numeric без JS-float.
    await tx.execute(sql`
      update inventory_count_lines l set fact_qty = (
        select coalesce(sum(e.qty), 0) from inventory_count_entries e
        where e.line_id = l.id and e.deleted_at is null)
      where l.count_id = ${id} and not l.skipped`);
    await tx.execute(sql`update inventory_count_lines set fact_qty = null where count_id = ${id} and skipped`);
    await tx
      .update(inventory_counts)
      .set({ status: to, submitted_by: actor.userId, submitted_at: sql`now()`, updated_at: sql`now()` })
      .where(eq(inventory_counts.id, id));
    // id авто-пропущенных строк — чтобы «Вернуть в черновик» снял с них пометку.
    await writeEvent(tx, id, "submitted", actor.userId, {
      auto_skipped: incomplete.length,
      auto_skipped_ids: incomplete.map((x) => x.id),
    });
    return { ok: true as const };
  });
}

/** Вернуть отправленный пересчёт в черновик — только офис (inventory.reconcile), не филиал. */
export function canReopen(actor: Actor): boolean {
  return actor.perms.includes("inventory.reconcile");
}

export async function reopenCount(db: DbLike, actor: Actor, id: string, now: Date) {
  return db.transaction(async (tx) => {
    if (!canReopen(actor)) throw new InventoryError(403, "forbidden");
    const row = await lockCount(tx, id);
    const to = nextStatus("reopen", row.status);
    if (!to) throw new InventoryError(409, "not_submitted", { status: row.status });
      await tx.update(inventory_count_lines).set({ fact_qty: null }).where(eq(inventory_count_lines.count_id, id));
    // Снимаем «не считали», которое поставила последняя отправка (skip_incomplete);
    // строки, которые человек отметил сам, остаются пропущенными.
    const [lastSubmit] = await tx
      .select({ payload: inventory_count_events.payload })
      .from(inventory_count_events)
      .where(and(eq(inventory_count_events.count_id, id), eq(inventory_count_events.type, "submitted")))
      .orderBy(desc(inventory_count_events.created_at))
      .limit(1);
    const autoSkipped = ((lastSubmit?.payload as { auto_skipped_ids?: string[] } | null)?.auto_skipped_ids ?? []).filter(
      (x) => UUID_RE.test(x)
    );
    if (autoSkipped.length) {
      await tx
        .update(inventory_count_lines)
        .set({ skipped: false, skipped_by: null })
        .where(and(eq(inventory_count_lines.count_id, id), inArray(inventory_count_lines.id, autoSkipped)));
    }
    await tx
      .update(inventory_counts)
      .set({ status: to, submitted_by: null, submitted_at: null, updated_at: sql`now()` })
      .where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "reopened", actor.userId);
    return { ok: true as const };
  });
}

export async function cancelCount(db: DbLike, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const row = await requireManagedCount(tx, actor, id);
    const to = nextStatus("cancel", row.status);
    if (!to) throw new InventoryError(409, "not_draft", { status: row.status });
    await tx.update(inventory_counts).set({ status: to, updated_at: sql`now()` }).where(eq(inventory_counts.id, id));
    await writeEvent(tx, id, "cancelled", actor.userId);
    return { ok: true as const };
  });
}
