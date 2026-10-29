import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { loadBranchConfig, saveBranchConfig } from "../branch-settings";
import { run } from "../errors";

export const branchConfigRoutes = new Elysia({ name: "@api/kpi/branch-config" })
  .use(ctx)
  .get("/kpi/branch-indicators", async ({ drizzle, set }) => run(set, async () => loadBranchConfig(drizzle)), {
    permission: "kpi.manage",
  })
  .put(
    "/kpi/branch-indicators",
    async ({ body, user, drizzle, set }) => run(set, async () => saveBranchConfig(drizzle, body, user!.id)),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  );
