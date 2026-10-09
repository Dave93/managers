// Маршруты «Сравнение с учётом» и «Остатки склада» (spec 2026-10-08, §6). Плагин без своего
// префикса: подключается внутри inventoryControllerImpl (/api). Доступ проверяется в коде:
// офис и филиал видят разное (см. stock.ts).
import { ctx } from "@backend/context";
import { inventory_counts } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom } from "../access";
import { assertUuid } from "../counts";
import { InventoryError, run } from "../errors";
import { enqueueBookFor } from "./queue";
import { listInterimRecons, loadInterimRecon, markInterimLine } from "./interim";
import { loadBook, loadStock, loadStockMovement } from "./stock";

export const bookRoutes = new Elysia({ name: "@api/inventory/book" })
  .use(ctx)
  .get(
    "/inventory/counts/:id/book",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadBook(drizzle, await actorFrom(cacheController, user, role), params.id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/counts/:id/book/refresh",
    async ({ params, drizzle, set }) =>
      run(set, async () => {
        assertUuid(params.id);
        const [count] = await drizzle.select({ status: inventory_counts.status }).from(inventory_counts).where(eq(inventory_counts.id, params.id));
        if (!count) throw new InventoryError(404, "not_found");
        if (count.status !== "submitted") throw new InventoryError(409, "not_submitted");
        return enqueueBookFor(drizzle, params.id);
      }),
    { permission: "inventory.reconcile", params: t.Object({ id: t.String() }) }
  )
  .get(
    "/inventory/stock",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadStock(drizzle, await actorFrom(cacheController, user, role), query.store_id)),
    { permission: "inventory.count", query: t.Object({ store_id: t.String() }) }
  )
  .get(
    "/inventory/stock/movements",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        loadStockMovement(drizzle, await actorFrom(cacheController, user, role), query.store_id, query.product_id)
      ),
    { permission: "inventory.count", query: t.Object({ store_id: t.String(), product_id: t.String() }) }
  )
  .get(
    "/inventory/interim-reconciliations",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => listInterimRecons(drizzle, await actorFrom(cacheController, user, role), query.period)),
    // Филиал видит свои склады только для просмотра; отметка «проверено» — только офис.
    { permission: "inventory.count", query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/interim-reconciliations/:id",
    async ({ params, user, role, drizzle, cacheController, set }) =>
      run(set, async () => loadInterimRecon(drizzle, await actorFrom(cacheController, user, role), params.id)),
    { permission: "inventory.count", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/interim-reconciliations/:id/lines/:productId/mark",
    async ({ params, body, drizzle, user, set }) =>
      run(set, async () => markInterimLine(drizzle, params.id, params.productId, body.checked, user!.id)),
    {
      permission: "inventory.reconcile",
      params: t.Object({ id: t.String(), productId: t.String() }),
      body: t.Object({ checked: t.Boolean() }),
    }
  );
