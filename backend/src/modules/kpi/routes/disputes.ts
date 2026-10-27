import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny } from "../access";
import { listDisputes, openDispute, resolveDispute } from "../disputes";
import { run } from "../errors";
import type { ItemInput } from "../reviews";
import { itemsSchema } from "./reviews";

export const disputesRoutes = new Elysia({ name: "@api/kpi/disputes" })
  .use(ctx)
  .get(
    "/kpi/disputes",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.view", "kpi.evaluate", "kpi.approve"]);
        return listDisputes(drizzle, actor, query);
      }),
    {
      userAuth: true,
      query: t.Object({ status: t.Optional(t.String()), period: t.Optional(t.String()) }),
    }
  )
  .post(
    "/kpi/disputes",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.approve"]);
        return openDispute(drizzle, actor, {
          subject_type: body.subject_type as any,
          subject_id: body.subject_id as string,
          reason: body.reason as string,
        });
      }),
    {
      userAuth: true,
      // Значения проверяет сервис: неверное — наш код ошибки, а не ответ схемы.
      body: t.Object({
        subject_type: t.Optional(t.Any()),
        subject_id: t.Optional(t.Any()),
        reason: t.Optional(t.Any()),
      }),
    }
  )
  .post(
    "/kpi/disputes/:id/resolve",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.approve"]);
        return resolveDispute(drizzle, actor, params.id, {
          decision: body.decision as any,
          comment: body.comment as string,
          items: body.items as ItemInput[] | undefined,
        });
      }),
    {
      userAuth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        decision: t.Optional(t.Any()),
        comment: t.Optional(t.Any()),
        items: t.Optional(itemsSchema),
      }),
    }
  );
