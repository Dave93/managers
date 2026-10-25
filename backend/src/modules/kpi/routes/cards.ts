import { ctx } from "@backend/context";
import { kpi_card_items, kpi_cards } from "backend/drizzle/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny, type DbLike } from "../access";
import { KpiError, run } from "../errors";
import { ITEM_SOURCES, type ItemSource } from "../rules";
import type { Card, CardItem } from "../types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUPS = ["base", "extra"];

type Body = Record<string, unknown>;

// Непустая строка не длиннее max (после trim).
function title(v: unknown, code: string, max = 300): string {
  if (typeof v !== "string" || v.trim() === "" || v.trim().length > max) throw new KpiError(422, code);
  return v.trim();
}
function optText(v: unknown, code: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new KpiError(422, code);
  return v.trim() === "" ? null : v.trim();
}
function weightOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) throw new KpiError(422, "bad_weight");
  return v;
}
function sourceOf(v: unknown): ItemSource {
  if (typeof v !== "string" || !ITEM_SOURCES.includes(v as ItemSource)) throw new KpiError(422, "bad_source");
  return v as ItemSource;
}
function groupOf(v: unknown): "base" | "extra" {
  if (typeof v !== "string" || !GROUPS.includes(v)) throw new KpiError(422, "bad_group");
  return v as "base" | "extra";
}
function sortOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100000) throw new KpiError(422, "bad_sort");
  return v;
}
function rolesOf(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim() === "")) {
    throw new KpiError(422, "bad_staff_roles");
  }
  return [...new Set(v.map((x: string) => x.trim()))];
}
function boolOf(v: unknown): boolean {
  if (typeof v !== "boolean") throw new KpiError(422, "bad_active");
  return v;
}

function toItem(r: typeof kpi_card_items.$inferSelect): CardItem {
  return {
    id: r.id,
    card_id: r.card_id,
    sort: r.sort,
    title_ru: r.title_ru,
    title_uz: r.title_uz,
    hint_ru: r.hint_ru,
    hint_uz: r.hint_uz,
    source: r.source as ItemSource,
    weight: r.weight,
    group_key: r.group_key as "base" | "extra",
    active: r.active,
  };
}

async function loadCards(db: DbLike, o: { includeInactive: boolean; id?: string }): Promise<Card[]> {
  const cardRows = await db
    .select()
    .from(kpi_cards)
    .where(
      and(
        o.includeInactive ? undefined : eq(kpi_cards.active, true),
        o.id ? eq(kpi_cards.id, o.id) : undefined
      )
    )
    .orderBy(asc(kpi_cards.sort), asc(kpi_cards.code));
  if (cardRows.length === 0) return [];
  const itemRows = await db
    .select()
    .from(kpi_card_items)
    .where(o.includeInactive ? undefined : eq(kpi_card_items.active, true))
    .orderBy(asc(kpi_card_items.sort), asc(kpi_card_items.created_at));
  const byCard = new Map<string, CardItem[]>();
  for (const r of itemRows) {
    const list = byCard.get(r.card_id) ?? [];
    list.push(toItem(r));
    byCard.set(r.card_id, list);
  }
  return cardRows.map((c) => ({
    id: c.id,
    code: c.code,
    title_ru: c.title_ru,
    title_uz: c.title_uz,
    staff_role_codes: c.staff_role_codes,
    active: c.active,
    sort: c.sort,
    items: byCard.get(c.id) ?? [],
  }));
}

async function loadCard(db: DbLike, id: string): Promise<Card> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const [card] = await loadCards(db, { includeInactive: true, id });
  if (!card) throw new KpiError(404, "not_found");
  return card;
}

export const cardsRoutes = new Elysia({ name: "@api/kpi/cards" })
  .use(ctx)
  .get(
    "/kpi/cards",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        return loadCards(drizzle, { includeInactive: query.include_inactive === "1" });
      }),
    { userAuth: true, query: t.Object({ include_inactive: t.Optional(t.String()) }) }
  )
  .post(
    "/kpi/cards",
    async ({ body, drizzle, set }) =>
      run(set, async () => {
        const b = body as Body;
        const code = typeof b.code === "string" ? b.code.trim() : "";
        if (!/^[a-z0-9_]{1,40}$/.test(code)) throw new KpiError(422, "bad_code");
        const values = {
          code,
          title_ru: title(b.title_ru, "bad_title"),
          title_uz: title(b.title_uz, "bad_title"),
          staff_role_codes: rolesOf(b.staff_role_codes ?? []),
        };
        return drizzle.transaction(async (tx) => {
          let sort: number;
          if (b.sort !== undefined) sort = sortOf(b.sort);
          else {
            const [m] = await tx.select({ m: sql<number>`coalesce(max(${kpi_cards.sort}), 0)::int` }).from(kpi_cards);
            sort = m.m + 10;
          }
          const [row] = await tx
            .insert(kpi_cards)
            .values({ ...values, sort })
            .onConflictDoNothing({ target: kpi_cards.code })
            .returning({ id: kpi_cards.id });
          if (!row) throw new KpiError(409, "code_taken");
          return loadCard(tx, row.id);
        });
      }),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  )
  .put(
    "/kpi/cards/:id",
    async ({ params, body, drizzle, set }) =>
      run(set, async () => {
        const b = body as Body;
        await loadCard(drizzle, params.id);
        const patch: Partial<typeof kpi_cards.$inferInsert> = {};
        if (b.title_ru !== undefined) patch.title_ru = title(b.title_ru, "bad_title");
        if (b.title_uz !== undefined) patch.title_uz = title(b.title_uz, "bad_title");
        if (b.staff_role_codes !== undefined) patch.staff_role_codes = rolesOf(b.staff_role_codes);
        if (b.active !== undefined) patch.active = boolOf(b.active);
        if (b.sort !== undefined) patch.sort = sortOf(b.sort);
        await drizzle
          .update(kpi_cards)
          .set({ ...patch, updated_at: sql`now()` })
          .where(eq(kpi_cards.id, params.id));
        return loadCard(drizzle, params.id);
      }),
    { permission: "kpi.manage", params: t.Object({ id: t.String() }), body: t.Record(t.String(), t.Any()) }
  )
  .post(
    "/kpi/cards/:id/items",
    async ({ params, body, drizzle, set }) =>
      run(set, async () => {
        const b = body as Body;
        await loadCard(drizzle, params.id);
        const values = {
          title_ru: title(b.title_ru, "bad_title"),
          title_uz: title(b.title_uz, "bad_title"),
          hint_ru: optText(b.hint_ru, "bad_hint"),
          hint_uz: optText(b.hint_uz, "bad_hint"),
          source: sourceOf(b.source),
          weight: weightOf(b.weight),
          group_key: groupOf(b.group_key),
        };
        let sort: number;
        if (b.sort !== undefined) sort = sortOf(b.sort);
        else {
          const [m] = await drizzle
            .select({ m: sql<number>`coalesce(max(${kpi_card_items.sort}), 0)::int` })
            .from(kpi_card_items)
            .where(eq(kpi_card_items.card_id, params.id));
          sort = m.m + 10;
        }
        const [row] = await drizzle
          .insert(kpi_card_items)
          .values({ ...values, sort, card_id: params.id })
          .returning();
        return toItem(row);
      }),
    { permission: "kpi.manage", params: t.Object({ id: t.String() }), body: t.Record(t.String(), t.Any()) }
  )
  .put(
    "/kpi/items/:id",
    async ({ params, body, drizzle, set }) =>
      run(set, async () => {
        const b = body as Body;
        if (!UUID_RE.test(params.id)) throw new KpiError(404, "not_found");
        const [exists] = await drizzle
          .select({ id: kpi_card_items.id })
          .from(kpi_card_items)
          .where(eq(kpi_card_items.id, params.id))
          .limit(1);
        if (!exists) throw new KpiError(404, "not_found");
        const patch: Partial<typeof kpi_card_items.$inferInsert> = {};
        if (b.title_ru !== undefined) patch.title_ru = title(b.title_ru, "bad_title");
        if (b.title_uz !== undefined) patch.title_uz = title(b.title_uz, "bad_title");
        if (b.hint_ru !== undefined) patch.hint_ru = optText(b.hint_ru, "bad_hint");
        if (b.hint_uz !== undefined) patch.hint_uz = optText(b.hint_uz, "bad_hint");
        if (b.source !== undefined) patch.source = sourceOf(b.source);
        if (b.weight !== undefined) patch.weight = weightOf(b.weight);
        if (b.group_key !== undefined) patch.group_key = groupOf(b.group_key);
        if (b.active !== undefined) patch.active = boolOf(b.active);
        if (b.sort !== undefined) patch.sort = sortOf(b.sort);
        const [row] = await drizzle
          .update(kpi_card_items)
          .set({ ...patch, updated_at: sql`now()` })
          .where(eq(kpi_card_items.id, params.id))
          .returning();
        return toItem(row);
      }),
    { permission: "kpi.manage", params: t.Object({ id: t.String() }), body: t.Record(t.String(), t.Any()) }
  );
