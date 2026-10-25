import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, parsePeriod, requireAny } from "../access";
import { branchBreakdown, branchNetwork, computeBranch } from "../branch";
import { run } from "../errors";

const VIEW = ["kpi.view", "kpi.manage", "kpi.approve"];

export const branchRoutes = new Elysia({ name: "@api/kpi/branch" })
  .use(ctx)
  .get(
    "/kpi/branch",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, VIEW);
        return branchNetwork(drizzle, actor, parsePeriod(query.period));
      }),
    { userAuth: true, query: t.Object({ period: t.Optional(t.String()) }) }
  )
  .get(
    "/kpi/branch/:terminal_id",
    async ({ params, query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, VIEW);
        return branchBreakdown(drizzle, actor, params.terminal_id, parsePeriod(query.period));
      }),
    { userAuth: true, query: t.Object({ period: t.Optional(t.String()) }) }
  )
  .post(
    "/kpi/branch/compute",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.manage", "kpi.approve"]);
        return computeBranch(drizzle, actor, parsePeriod(body.period));
      }),
    { userAuth: true, body: t.Record(t.String(), t.Any()) }
  );
