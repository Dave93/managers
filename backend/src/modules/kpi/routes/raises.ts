import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny } from "../access";
import { run } from "../errors";
import { computeQuarter, decideRaise, getTiers, listRaises, parseQuarter, raisesCsv, saveTiers } from "../raises";

const quarterQuery = t.Object({ quarter: t.Optional(t.String()) });

export const raisesRoutes = new Elysia({ name: "@api/kpi/raises" })
  .use(ctx)
  .get(
    "/kpi/raise-tiers",
    async ({ user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        return getTiers(drizzle);
      }),
    { userAuth: true }
  )
  .put(
    "/kpi/raise-tiers",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        return saveTiers(drizzle, actor, body.tiers);
      }),
    {
      permission: "kpi.manage",
      body: t.Object({ tiers: t.Array(t.Object({ min_pct: t.Number(), amount: t.Number() })) }),
    }
  )
  .get(
    "/kpi/raises",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.view", "kpi.manage", "kpi.approve"]);
        return listRaises(drizzle, actor, parseQuarter(query.quarter));
      }),
    { userAuth: true, query: quarterQuery }
  )
  .post(
    "/kpi/raises/compute",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.approve"]);
        return computeQuarter(drizzle, actor, parseQuarter(body.quarter));
      }),
    { userAuth: true, body: t.Object({ quarter: t.Optional(t.Any()) }) }
  )
  .post(
    "/kpi/raises/:id/decide",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.approve"]);
        return decideRaise(drizzle, actor, params.id, body as any);
      }),
    {
      userAuth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: t.String(), amount: t.Optional(t.Any()), comment: t.Optional(t.Any()) }),
    }
  )
  .get(
    "/kpi/raises/export",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.approve"]);
        const quarter = parseQuarter(query.quarter);
        const rows = await listRaises(drizzle, actor, quarter);
        const q = Math.floor((Number(quarter.slice(5, 7)) - 1) / 3) + 1;
        return new Response(raisesCsv(rows), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="kpi-raises-${quarter.slice(0, 4)}-Q${q}.csv"`,
          },
        });
      }),
    { userAuth: true, query: quarterQuery }
  );
