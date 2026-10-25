import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny } from "../access";
import { run } from "../errors";
import { createCheck, listChecks, sanitaryTemplate } from "../sanitary";

export const sanitaryRoutes = new Elysia({ name: "@api/kpi/sanitary" })
  .use(ctx)
  .get(
    "/kpi/sanitary-checks/template",
    async ({ user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.manage"]);
        return sanitaryTemplate(drizzle);
      }),
    { userAuth: true }
  )
  .get(
    "/kpi/sanitary-checks",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        return listChecks(drizzle, actor, { period: query.period as string, terminal_id: query.terminal_id });
      }),
    { userAuth: true, query: t.Object({ period: t.Optional(t.String()), terminal_id: t.Optional(t.String()) }) }
  )
  .post(
    "/kpi/sanitary-checks",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        return createCheck(drizzle, actor, body);
      }),
    { userAuth: true, body: t.Record(t.String(), t.Any()) }
  );
