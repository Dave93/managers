import { ctx } from "@backend/context";
import { corporation_store, users_stores } from "backend/drizzle/schema";
import { asc, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom } from "./access";
import { addLine, availableTemplates, cancelCount, createCount, listCounts, loadCount, reopenCount, searchProducts, setSkipped, submitCount, syncEntries } from "./counts";
import { run } from "./errors";
import { allowedPeriods } from "./rules";
import type { InventoryStore } from "./types";

const inventoryControllerImpl = new Elysia({ name: "@api/inventory", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .get(
    "/inventory/stores",
    async ({ user, role, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom(cacheController, user, role);
        const rows = await drizzle
          .select({
            id: corporation_store.id,
            name: corporation_store.name,
            organization_id: corporation_store.organization_id,
          })
          .from(users_stores)
          .innerJoin(corporation_store, eq(corporation_store.id, users_stores.corporation_store_id))
          .where(eq(users_stores.user_id, actor.userId))
          .orderBy(asc(corporation_store.name));
        return rows.map((r) => ({ ...r, name: r.name ?? "" })) as InventoryStore[];
      }),
    { permission: "inventory.count" }
  )
  .get("/inventory/periods", () => ({ periods: allowedPeriods(new Date()) }), {
    permission: "inventory.count",
  })
  .get(
    "/inventory/templates/available",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => availableTemplates(drizzle, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .post(
    "/inventory/counts",
    async ({ body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => createCount(drizzle, await actorFrom(cacheController, user, role), body, new Date())),
    {
      permission: "inventory.count",
      body: t.Object({ store_id: t.String(), template_id: t.String(), period: t.String() }),
    }
  )
  .get(
    "/inventory/counts",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => listCounts(drizzle, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .get(
    "/inventory/counts/:id",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/counts/:id/entries/sync",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => syncEntries(drizzle, await actorFrom(cacheController, user, role), params.id, body.ops)),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        ops: t.Array(
          t.Union([
            t.Object({
              op: t.Literal("add"),
              id: t.String(),
              line_id: t.String(),
              qty: t.Number(),
              client_created_at: t.String(),
            }),
            t.Object({ op: t.Literal("delete"), id: t.String() }),
          ]),
          { maxItems: 500 }
        ),
      }),
    }
  )
  .post(
    "/inventory/counts/:id/lines",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => addLine(drizzle, await actorFrom(cacheController, user, role), params.id, body.product_id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }), body: t.Object({ product_id: t.String() }) }
  )
  .patch(
    "/inventory/counts/:id/lines/:lineId",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        setSkipped(drizzle, await actorFrom(cacheController, user, role), params.id, params.lineId, body.skipped)
      ),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String(), lineId: t.String() }),
      body: t.Object({ skipped: t.Boolean() }),
    }
  )
  .get(
    "/inventory/products",
    async ({ query, drizzle }) => searchProducts(drizzle, query.q ?? "", Number(query.limit ?? 20)),
    { permission: "inventory.count", query: t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()) }) }
  )
  .post(
    "/inventory/counts/:id/submit",
    async ({ params, body, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        submitCount(drizzle, await actorFrom(cacheController, user, role), params.id, body?.skip_incomplete === true)
      ),
    {
      permission: "inventory.count",
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ skip_incomplete: t.Optional(t.Boolean()) })),
    }
  )
  .post(
    "/inventory/counts/:id/reopen",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => reopenCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/counts/:id/cancel",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => cancelCount(drizzle, await actorFrom(cacheController, user, role), params.id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  );

// Как tickets/cash_shifts: после apiController накопленный тип роутов у
// предела глубины TS (TS2589), поэтому тип расширяем. Фронт ходит через
// admin/lib/inventory-api.ts с типами из ./types.
export const inventoryController = inventoryControllerImpl as unknown as Elysia;
