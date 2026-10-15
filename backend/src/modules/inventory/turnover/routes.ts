// Маршруты ОСВ (spec 2026-10-14, §7). Плагин без префикса: подключается внутри inventoryControllerImpl (/api).
import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, storeAccess } from "../access";
import { assertUuid } from "../counts";
import { InventoryError, run } from "../errors";
import { turnoverBounds } from "./pure";
import { enqueueTurnover, readTurnoverOverview, turnoverQueue } from "./queue";
import { listTurnoverPeriods, loadStoreTurnover, loadSummary } from "./read";

export const turnoverRoutes = new Elysia({ name: "@api/inventory/turnover" })
  .use(ctx)
  .get(
    "/inventory/turnover/periods",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () => listTurnoverPeriods(drizzle, await actorFrom(cacheController, user, role), query.store_id, new Date())),
    { permission: "inventory.count", query: t.Object({ store_id: t.Optional(t.String()) }) }
  )
  .get(
    "/inventory/turnover/summary",
    async ({ query, drizzle, redis, set }) => run(set, async () => loadSummary(drizzle, redis, query.period)),
    { permission: "inventory.templates", query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/turnover/status",
    async ({ query, redis, set }) => run(set, async () => readTurnoverOverview(redis, query.period, turnoverQueue())),
    // Статус нужен только кнопке «Обновить» — те же права, что у POST /refresh.
    { permission: "inventory.reconcile", query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/turnover",
    async ({ query, user, role, drizzle, cacheController, set }) =>
      run(set, async () =>
        loadStoreTurnover(drizzle, await actorFrom(cacheController, user, role), query.period, query.store_id, new Date())
      ),
    { permission: "inventory.count", query: t.Object({ period: t.String(), store_id: t.String() }) }
  )
  .post(
    "/inventory/turnover/refresh",
    async ({ body, user, role, drizzle, redis, cacheController, set }) =>
      run(set, async () => {
        // 422 на кривой или будущий месяц; 1-е число текущего — задача просто ничего не загрузит.
        turnoverBounds(body.period, new Date());
        const actor = await actorFrom(cacheController, user, role);
        // Склад — только доступный пользователю; весь месяц (все склады, ~6 мин iiko) — только офису.
        if (body.store_id) {
          assertUuid(body.store_id);
          if ((await storeAccess(drizzle, actor, body.store_id)) === "none") throw new InventoryError(403, "store_forbidden");
        } else if (!actor.perms.includes("inventory.templates")) {
          throw new InventoryError(403, "store_required");
        }
        return enqueueTurnover(turnoverQueue(), redis, { period: body.period, storeId: body.store_id ?? null });
      }),
    { permission: "inventory.reconcile", body: t.Object({ period: t.String(), store_id: t.Optional(t.String()) }) }
  );
