import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, parsePeriod, requireAny } from "../access";
import { run } from "../errors";
import { closePeriod, periodSummary, reopenPeriod } from "../periods";

export const periodsRoutes = new Elysia({ name: "@api/kpi/periods" })
  .use(ctx)
  .get(
    "/kpi/periods/:period",
    async ({ params, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.view", "kpi.manage", "kpi.approve"]);
        return periodSummary(drizzle, actor, parsePeriod(params.period));
      }),
    { userAuth: true, params: t.Object({ period: t.String() }) }
  )
  .post(
    "/kpi/periods/:period/close",
    async ({ params, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.approve"]);
        return closePeriod(drizzle, actor, parsePeriod(params.period));
      }),
    { userAuth: true, params: t.Object({ period: t.String() }) }
  )
  .post(
    "/kpi/periods/:period/reopen",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.approve"]);
        return reopenPeriod(drizzle, actor, parsePeriod(params.period), body?.comment as string);
      }),
    {
      userAuth: true,
      params: t.Object({ period: t.String() }),
      body: t.Optional(t.Object({ comment: t.Optional(t.Any()) })),
    }
  );
