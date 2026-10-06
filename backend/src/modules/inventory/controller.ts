import { ctx } from "@backend/context";
import { corporation_store, users_stores } from "backend/drizzle/schema";
import { asc, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom } from "./access";
import { addLine, availableTemplates, cancelCount, createCount, listCounts, loadCount, productScope, reopenCount, searchProducts, setSkipped, submitCount, syncEntries, unlockCount } from "./counts";
import { run } from "./errors";
import {
  createTemplate,
  deleteTemplate,
  folders,
  getTemplate,
  listOrganizations,
  listTemplates,
  overview,
  replaceItems,
  suggestions,
  updateTemplate,
} from "./templates";
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
    async ({ query, user, role, drizzle, redis, cacheController, set }) =>
      run(set, async () => availableTemplates(drizzle, redis, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .post(
    "/inventory/counts",
    async ({ body, user, role, drizzle, redis, cacheController, set }) =>
      run(set, async () => createCount(drizzle, redis, await actorFrom(cacheController, user, role), body, new Date())),
    {
      permission: "inventory.count",
      body: t.Object({ store_id: t.String(), template_id: t.Optional(t.String()), period: t.String() }),
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
    async ({ query, user, role, drizzle, redis, cacheController, set }) =>
      run(set, async () => {
        const scope = query.count_id
          ? await productScope(drizzle, redis, await actorFrom(cacheController, user, role), query.count_id)
          : {};
        return searchProducts(drizzle, query.q ?? "", Number(query.limit ?? 20), scope);
      }),
    {
      permission: "inventory.count",
      query: t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()), count_id: t.Optional(t.String()) }),
    }
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
  )
  .post(
    "/inventory/counts/:id/unlock",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => unlockCount(drizzle, await actorFrom(cacheController, user, role), params.id, new Date())),
    { permission: "inventory.reconcile", params: t.Object({ id: t.String() }) }
  )
  .get(
    "/inventory/templates",
    async ({ query, drizzle }) => listTemplates(drizzle, query.organization_id),
    { permission: "inventory.templates", query: t.Object({ organization_id: t.Optional(t.String()) }) }
  )
  .post(
    "/inventory/templates",
    async ({ body, user, role, drizzle, cacheController, set }) =>
      run(set, async () => createTemplate(drizzle, await actorFrom(cacheController, user, role), body)),
    {
      permission: "inventory.templates",
      body: t.Object({
        organization_id: t.String(),
        name: t.String(),
        active: t.Optional(t.Boolean()),
        sort: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/inventory/templates/:id",
    async ({ params, drizzle, set }) => run(set, async () => getTemplate(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .patch(
    "/inventory/templates/:id",
    async ({ params, body, drizzle, set }) => run(set, async () => updateTemplate(drizzle, params.id, body)),
    {
      permission: "inventory.templates",
      params: t.Object({ id: t.String() }),
      body: t.Object({ name: t.Optional(t.String()), active: t.Optional(t.Boolean()), sort: t.Optional(t.Number()) }),
    }
  )
  .delete(
    "/inventory/templates/:id",
    async ({ params, drizzle, set }) => run(set, async () => deleteTemplate(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .put(
    "/inventory/templates/:id/items",
    async ({ params, body, drizzle, set }) => run(set, async () => replaceItems(drizzle, params.id, body.product_ids)),
    {
      permission: "inventory.templates",
      params: t.Object({ id: t.String() }),
      body: t.Object({ product_ids: t.Array(t.String(), { maxItems: 5000 }) }),
    }
  )
  .get(
    "/inventory/templates/:id/suggestions",
    async ({ params, drizzle, set }) => run(set, async () => suggestions(drizzle, params.id)),
    { permission: "inventory.templates", params: t.Object({ id: t.String() }) }
  )
  .get("/inventory/folders", async ({ drizzle }) => folders(drizzle), { permission: "inventory.templates" })
  .get("/inventory/organizations", async ({ drizzle }) => listOrganizations(drizzle), { permission: "inventory.templates" })
  .get(
    "/inventory/overview",
    async ({ query, drizzle, set }) => run(set, async () => overview(drizzle, query.period, query.organization_id)),
    { permission: "inventory.templates", query: t.Object({ period: t.String(), organization_id: t.Optional(t.String()) }) }
  );

// Как tickets/cash_shifts: после apiController накопленный тип роутов у
// предела глубины TS (TS2589), поэтому тип расширяем. Фронт ходит через
// admin/lib/inventory-api.ts с типами из ./types.
export const inventoryController = inventoryControllerImpl as unknown as Elysia;
