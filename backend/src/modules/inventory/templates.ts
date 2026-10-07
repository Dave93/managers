import {
  corporation_store,
  inventory_count_lines,
  inventory_counts,
  inventory_template_items,
  inventory_templates,
  measure_unit,
  nomenclature_element,
  nomenclature_group,
  organization,
} from "backend/drizzle/schema";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Actor, DbLike } from "./access";
import { assertUuid, summaries, TEMPLATE_ID } from "./counts";
import { InventoryError } from "./errors";
import { isValidPeriod, UUID_RE } from "./rules";
import type {
  InventoryFolders,
  InventoryOverviewRow,
  InventorySuggestion,
  InventoryTemplateDetail,
  InventoryTemplateSummary,
} from "./types";

const templateColumns = {
  id: inventory_templates.id,
  organization_id: inventory_templates.organization_id,
  organization_name: organization.name,
  name: inventory_templates.name,
  active: inventory_templates.active,
  sort: inventory_templates.sort,
  items_count: sql<number>`(select count(*)::int from inventory_template_items ti where ti.template_id = ${TEMPLATE_ID})`,
};

export async function listTemplates(db: DbLike, organizationId?: string): Promise<InventoryTemplateSummary[]> {
  const where = organizationId && UUID_RE.test(organizationId) ? eq(inventory_templates.organization_id, organizationId) : undefined;
  const rows = await db
    .select(templateColumns)
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(where)
    .orderBy(asc(inventory_templates.sort), asc(inventory_templates.name));
  return rows.map((r) => ({ ...r, organization_name: r.organization_name ?? null }));
}

export async function getTemplate(db: DbLike, id: string): Promise<InventoryTemplateDetail> {
  assertUuid(id);
  const [row] = await db
    .select(templateColumns)
    .from(inventory_templates)
    .leftJoin(organization, eq(organization.id, inventory_templates.organization_id))
    .where(eq(inventory_templates.id, id));
  if (!row) throw new InventoryError(404, "not_found");
  const items = await db
    .select({ product_id: inventory_template_items.product_id })
    .from(inventory_template_items)
    .where(eq(inventory_template_items.template_id, id));
  return { ...row, organization_name: row.organization_name ?? null, product_ids: items.map((i) => i.product_id) };
}

export async function createTemplate(
  db: DbLike,
  actor: Actor,
  input: { organization_id: string; name: string; active?: boolean; sort?: number }
) {
  assertUuid(input.organization_id);
  const name = input.name.trim();
  if (!name) throw new InventoryError(422, "name_required");
  const [row] = await db
    .insert(inventory_templates)
    .values({
      organization_id: input.organization_id,
      name,
      active: input.active ?? true,
      sort: input.sort ?? 0,
      created_by: actor.userId,
    })
    .returning({ id: inventory_templates.id });
  return { id: row.id };
}

export async function updateTemplate(db: DbLike, id: string, patch: { name?: string; active?: boolean; sort?: number }) {
  assertUuid(id);
  const set: Partial<typeof inventory_templates.$inferInsert> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new InventoryError(422, "name_required");
    set.name = name;
  }
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.sort !== undefined) set.sort = patch.sort;
  const updated = await db
    .update(inventory_templates)
    .set(set)
    .where(eq(inventory_templates.id, id))
    .returning({ id: inventory_templates.id });
  if (!updated.length) throw new InventoryError(404, "not_found");
  return { ok: true as const };
}

export async function deleteTemplate(db: DbLike, id: string) {
  assertUuid(id);
  const [used] = await db
    .select({ id: inventory_counts.id })
    .from(inventory_counts)
    .where(eq(inventory_counts.template_id, id))
    .limit(1);
  if (used) throw new InventoryError(409, "in_use");
  const deleted = await db.delete(inventory_templates).where(eq(inventory_templates.id, id)).returning({ id: inventory_templates.id });
  if (!deleted.length) throw new InventoryError(404, "not_found");
  return { ok: true as const };
}

export async function replaceItems(db: DbLike, id: string, productIds: string[]) {
  assertUuid(id);
  const uniq = [...new Set(productIds)];
  if (uniq.some((p) => !UUID_RE.test(p))) throw new InventoryError(422, "invalid_product_id");
  return db.transaction(async (tx) => {
    const [tpl] = await tx.select({ id: inventory_templates.id }).from(inventory_templates).where(eq(inventory_templates.id, id)).for("update");
    if (!tpl) throw new InventoryError(404, "not_found");
    await tx.delete(inventory_template_items).where(eq(inventory_template_items.template_id, id));
    if (uniq.length) {
      await tx.insert(inventory_template_items).values(uniq.map((product_id) => ({ template_id: id, product_id })));
    }
    await tx.update(inventory_templates).set({ updated_at: new Date().toISOString() }).where(eq(inventory_templates.id, id));
    return { items_count: uniq.length };
  });
}

export async function folders(db: DbLike): Promise<InventoryFolders> {
  const groups = await db
    .select({ id: nomenclature_group.id, name: nomenclature_group.name, parent_id: nomenclature_group.parent_id })
    .from(nomenclature_group)
    .where(eq(nomenclature_group.deleted, false))
    .orderBy(asc(nomenclature_group.name));
  const products = await db
    .select({
      id: nomenclature_element.id,
      name: nomenclature_element.name,
      unit_name: measure_unit.name,
      parent_id: nomenclature_element.parent_id,
    })
    .from(nomenclature_element)
    .leftJoin(measure_unit, eq(measure_unit.id, nomenclature_element.mainUnit))
    .where(
      and(
        sql`coalesce(${nomenclature_element.deleted}, false) = false`,
        inArray(nomenclature_element.type, ["GOODS", "PREPARED"])
      )
    )
    .orderBy(asc(nomenclature_element.name));
  return {
    groups,
    products: products.map((p) => ({ ...p, name: p.name ?? "", unit_name: p.unit_name ?? null })),
  };
}

export async function suggestions(db: DbLike, id: string): Promise<InventorySuggestion[]> {
  assertUuid(id);
  const rows = await db.execute(sql`
    select l.product_id, max(l.product_name) as product_name, count(*)::int as times
    from inventory_count_lines l
    join inventory_counts c on c.id = l.count_id
    where c.template_id = ${id}
      and c.status <> 'cancelled'
      and l.source = 'added'
      and l.product_id not in (select ti.product_id from inventory_template_items ti where ti.template_id = ${id})
    group by l.product_id
    order by times desc, product_name
    limit 50
  `);
  return rows.rows as unknown as InventorySuggestion[];
}

export async function listOrganizations(db: DbLike): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(asc(organization.name));
}

export async function overview(db: DbLike, period: string, organizationId?: string): Promise<InventoryOverviewRow[]> {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
  const storeWhere = organizationId && UUID_RE.test(organizationId) ? eq(corporation_store.organization_id, organizationId) : undefined;
  const stores = await db
    .select({ id: corporation_store.id, name: corporation_store.name, organization_id: corporation_store.organization_id })
    .from(corporation_store)
    .where(storeWhere)
    .orderBy(asc(corporation_store.name));
  if (!stores.length) return [];
  const rows = await db
    .select({
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
    })
    .from(inventory_counts)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_counts.store_id))
    .where(
      and(
        eq(inventory_counts.period, period),
        ne(inventory_counts.status, "cancelled"),
        inArray(inventory_counts.store_id, stores.map((s) => s.id))
      )
    );
  const sums = await summaries(db, rows);
  // У склада есть непустой список товаров из exord (store_product_links).
  const exordRes: any = await db.execute(sql`
    select store_id::text as store_id from store_product_links where cardinality(product_ids) > 0`);
  const exordStores = new Set<string>((exordRes.rows ?? exordRes).map((r: any) => String(r.store_id)));
  const byStore = new Map<string, typeof sums>();
  for (const s of sums) byStore.set(s.store_id, [...(byStore.get(s.store_id) ?? []), s]);
  return stores.map((s) => ({
    store_id: s.id,
    store_name: s.name ?? "",
    organization_id: s.organization_id,
    exord: exordStores.has(s.id),
    counts: byStore.get(s.id) ?? [],
  }));
}
