import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { parsePeriod } from "../access";
import { run } from "../errors";
import { listPlans, savePlans, suggestPlans } from "../revenue-plans";

export const revenuePlansRoutes = new Elysia({ name: "@api/kpi/revenue-plans" })
  .use(ctx)
  .get(
    "/kpi/revenue-plans",
    async ({ query, drizzle, set }) => run(set, async () => listPlans(drizzle, parsePeriod(query.period))),
    { permission: "kpi.manage", query: t.Object({ period: t.Optional(t.String()) }) }
  )
  .put(
    "/kpi/revenue-plans",
    async ({ body, user, drizzle, set }) => run(set, async () => savePlans(drizzle, user!.id, body)),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  )
  .get(
    "/kpi/revenue-plans/suggest",
    async ({ query, drizzle, set }) => run(set, async () => suggestPlans(drizzle, parsePeriod(query.period), query.growth_pct)),
    { permission: "kpi.manage", query: t.Object({ period: t.Optional(t.String()), growth_pct: t.Optional(t.String()) }) }
  );
