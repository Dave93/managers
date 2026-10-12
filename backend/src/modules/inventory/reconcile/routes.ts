// Маршруты сверки (spec 2026-10-06, §6). Плагин без своего префикса: подключается
// внутри inventoryControllerImpl, который даёт /api. Все — под inventory.reconcile:
// филиал цифр iiko не видит.
import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { reopenRule, setReopenRule } from "../counts";
import { InventoryError, run } from "../errors";
import { isValidPeriod } from "../rules";
import { assertNotRunning, enqueueReconcile, readStatus, reconcileQueue } from "./queue";
import { chooseDocument, listReconciliations, loadReconciliation, reconTarget, setLineMark, setReconStatus } from "./read";

function assertPeriod(period: string) {
  if (!isValidPeriod(period)) throw new InventoryError(422, "invalid_period");
}

const P = "inventory.reconcile";

export const reconcileRoutes = new Elysia({ name: "@api/inventory/reconcile" })
  .use(ctx)
  .get(
    "/inventory/reconciliations",
    async ({ query, drizzle, set }) =>
      run(set, async () => {
        assertPeriod(query.period);
        return listReconciliations(drizzle, query.period);
      }),
    { permission: P, query: t.Object({ period: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/fetch",
    async ({ body, user, redis, set }) =>
      run(set, async () => {
        assertPeriod(body.period);
        return enqueueReconcile(reconcileQueue(), redis, { period: body.period, userId: user!.id });
      }),
    { permission: P, body: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/reconciliations/fetch-status",
    async ({ query, redis, set }) =>
      run(set, async () => {
        assertPeriod(query.period);
        return readStatus(redis, query.period, reconcileQueue());
      }),
    { permission: P, query: t.Object({ period: t.String() }) }
  )
  .get(
    "/inventory/reconciliations/:id",
    async ({ params, drizzle, set }) => run(set, async () => loadReconciliation(drizzle, params.id, new Date())),
    { permission: P, params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/refresh",
    async ({ params, drizzle, redis, user, set }) =>
      run(set, async () => {
        const target = await reconTarget(drizzle, params.id);
        return enqueueReconcile(reconcileQueue(), redis, { period: target.period, storeId: target.store_id, userId: user!.id });
      }),
    { permission: P, params: t.Object({ id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/document",
    async ({ params, body, drizzle, redis, user, set }) =>
      run(set, async () => {
        // Сначала очередь: выбор не должен сохраниться, если загрузка сейчас не встанет.
        await assertNotRunning(reconcileQueue(), (await reconTarget(drizzle, params.id)).period);
        const target = await chooseDocument(drizzle, params.id, body.document_id, user!.id);
        return enqueueReconcile(reconcileQueue(), redis, { period: target.period, storeId: target.store_id, userId: user!.id });
      }),
    { permission: P, params: t.Object({ id: t.String() }), body: t.Object({ document_id: t.String() }) }
  )
  .post(
    "/inventory/reconciliations/:id/status",
    async ({ params, body, drizzle, user, set }) =>
      run(set, async () => setReconStatus(drizzle, params.id, body.status, body.comment ?? null, user!.id)),
    {
      permission: P,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Union([t.Literal("in_review"), t.Literal("accepted")]),
        comment: t.Optional(t.String({ maxLength: 2000 })),
      }),
    }
  )
  .post(
    "/inventory/reconciliations/:id/lines/:productId/mark",
    async ({ params, body, drizzle, user, set }) =>
      run(set, async () => setLineMark(drizzle, params.id, params.productId, body.checked, user!.id)),
    { permission: P, params: t.Object({ id: t.String(), productId: t.String() }), body: t.Object({ checked: t.Boolean() }) }
  )
  .get("/inventory/settings/reopen-rule", async ({ drizzle }) => ({ rule: await reopenRule(drizzle) }), { permission: P })
  .put(
    "/inventory/settings/reopen-rule",
    async ({ body, drizzle, set }) => run(set, async () => setReopenRule(drizzle, body.rule as any)),
    { permission: P, body: t.Object({ rule: t.String() }) }
  );
