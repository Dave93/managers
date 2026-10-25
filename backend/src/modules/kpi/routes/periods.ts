import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, parsePeriod, requireAny } from "../access";
import { run } from "../errors";

// Сводку месяца допишет задача 8; пока только проверка пути.
export const periodsRoutes = new Elysia({ name: "@api/kpi/periods" })
  .use(ctx)
  .get(
    "/kpi/periods/:period",
    async ({ params, user, role, terminals, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.view", "kpi.manage", "kpi.approve"]);
        return { period: parsePeriod(params.period) };
      }),
    { userAuth: true, params: t.Object({ period: t.String() }) }
  );
