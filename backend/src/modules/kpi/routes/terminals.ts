import { ctx } from "@backend/context";
import { terminals } from "backend/drizzle/schema";
import { asc, eq } from "drizzle-orm";
import Elysia from "elysia";
import { actorFrom, requireAny } from "../access";
import { run } from "../errors";
import type { KpiTerminal } from "../types";

// Список филиалов для экранов KPI. Общий /terminals/cached требует terminals.list,
// которого у KPI-ролей нет; id и название филиала не секретны, а отбор по зоне оценщика
// остаётся на экранах.
export const terminalsRoutes = new Elysia({ name: "@api/kpi/terminals" })
  .use(ctx)
  .get(
    "/kpi/terminals",
    async ({ user, role, terminals: userTerminals, drizzle, cacheController, set }) =>
      run(set, async (): Promise<KpiTerminal[]> => {
        const actor = await actorFrom({ user, role, terminals: userTerminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        return drizzle
          .select({ id: terminals.id, name: terminals.name })
          .from(terminals)
          .where(eq(terminals.active, true))
          .orderBy(asc(terminals.name));
      }),
    { userAuth: true }
  );
