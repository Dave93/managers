import {
  corporation_store,
  inventory_count_entries,
  inventory_count_events,
  inventory_count_lines,
  inventory_counts,
  inventory_templates,
  organization,
  users,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { canManage, storeAccess, type Actor, type DbLike } from "./access";
import { InventoryError } from "./errors";
import { allowedPeriods, canReopen, UUID_RE } from "./rules";
import type {
  InventoryCountDetail,
  InventoryCountStatus,
  InventoryCountSummary,
  InventoryEntry,
  InventoryLine,
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

// Снимок строки: название, единица, папка iiko «Родитель / Папка».
const GROUP_NAME_SQL = sql.raw(
  `case when g.id is null then 'Без группы' when gp.name is null then g.name else gp.name || ' / ' || g.name end`
);

export async function availableTemplates(db: DbLike, actor: Actor, storeId: string): Promise<InventoryTemplateSummary[]> {
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
      items_count: sql<number>`(select count(*)::int from inventory_template_items ti where ti.template_id = ${inventory_templates.id})`,
    })
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(and(...where))
    .orderBy(asc(inventory_templates.sort), asc(inventory_templates.name));
  return rows.map((r) => ({ ...r, organization_name: r.organization_name ?? null }));
}

function isUniqueViolation(e: any): boolean {
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function findActive(db: DbLike, storeId: string, period: string, templateId: string) {
  const [row] = await db
    .select({ id: inventory_counts.id })
    .from(inventory_counts)
    .where(
      and(
        eq(inventory_counts.store_id, storeId),
        eq(inventory_counts.period, period),
        eq(inventory_counts.template_id, templateId),
        ne(inventory_counts.status, "cancelled")
      )
    );
  return row ?? null;
}

export async function createCount(
  db: DbLike,
  actor: Actor,
  input: { store_id: string; template_id: string; period: string },
  now: Date
): Promise<{ id: string; existing: boolean }> {
  assertUuid(input.store_id);
  assertUuid(input.template_id);
  const access = await storeAccess(db, actor, input.store_id);
  if (!canManage(actor, access)) throw new InventoryError(403, "forbidden");
  if (!allowedPeriods(now).includes(input.period)) {
    throw new InventoryError(422, "invalid_period", { allowed: allowedPeriods(now) });
  }
  const [store] = await db.select().from(corporation_store).where(eq(corporation_store.id, input.store_id));
  if (!store) throw new InventoryError(404, "store_not_found");
  const [tpl] = await db.select().from(inventory_templates).where(eq(inventory_templates.id, input.template_id));
  if (!tpl || !tpl.active) throw new InventoryError(422, "template_unavailable");
  if (store.organization_id && store.organization_id !== tpl.organization_id) {
    throw new InventoryError(422, "template_unavailable");
  }

  const existing = await findActive(db, input.store_id, input.period, input.template_id);
  if (existing) return { id: existing.id, existing: true };

  try {
    const id = await db.transaction(async (tx) => {
      const [count] = await tx
        .insert(inventory_counts)
        .values({
          store_id: input.store_id,
          organization_id: store.organization_id ?? tpl.organization_id,
          template_id: tpl.id,
          template_name: tpl.name,
          period: input.period,
          status: "draft",
          created_by: actor.userId,
        })
        .returning({ id: inventory_counts.id });
      await tx.execute(sql`
        insert into inventory_count_lines (count_id, product_id, product_name, unit_id, unit_name, group_id, group_name, source)
        select ${count.id}, n.id, coalesce(n.name, ''), n."mainUnit", mu.name, g.id, ${GROUP_NAME_SQL}, 'template'
        from inventory_template_items ti
        join nomenclature_element n on n.id = ti.product_id
        left join measure_unit mu on mu.id = n."mainUnit"
        left join nomenclature_group g on g.id = n.parent_id
        left join nomenclature_group gp on gp.id = g.parent_id
        where ti.template_id = ${tpl.id}
      `);
      await writeEvent(tx, count.id, "created", actor.userId, { template_id: tpl.id, period: input.period });
      return count.id;
    });
    return { id, existing: false };
  } catch (e) {
    // Гонка двух «Начать»: частичный уникальный индекс отбил вторую вставку.
    if (isUniqueViolation(e)) {
      const row = await findActive(db, input.store_id, input.period, input.template_id);
      if (row) return { id: row.id, existing: true };
    }
    throw e;
  }
}

type SummaryBase = Pick<
  CountRow,
  "id" | "store_id" | "template_id" | "template_name" | "period" | "status" | "created_at" | "submitted_at" | "submitted_by"
> & { store_name: string | null };

const summaryColumns = {
  id: inventory_counts.id,
  store_id: inventory_counts.store_id,
  template_id: inventory_counts.template_id,
  template_name: inventory_counts.template_name,
  period: inventory_counts.period,
  status: inventory_counts.status,
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
      done: sql<number>`(count(*) filter (where ${l.skipped} or exists (select 1 from inventory_count_entries e where e.line_id = ${l.id} and e.deleted_at is null)))::int`,
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
      total: sql<string>`coalesce((select sum(e.qty) from inventory_count_entries e where e.line_id = ${l.id} and e.deleted_at is null), 0)::text`,
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
    can_reopen: manage && row.status === "submitted" && canReopen(row.period, now),
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
