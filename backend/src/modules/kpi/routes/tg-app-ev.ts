import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { now } from "../clock";
import { run } from "../errors";
import { kpiTgCtx } from "../tg-app/ctx";
import { evaluatorActor } from "../tg-app/ev-actor";
import { evEmployees } from "../tg-app/ev-list";
import type { EvEmployees } from "../tg-app/ev-types";

// Роуты оценщика в мини-приложении «Мой KPI» (/kpi/tg/ev/*). Тот же Bearer-guard kpiTgCtx, что у tgAppRoutes:
// он подключён после .use(ctx) и действует только на роуты, объявленные ниже.
// Каждый обработчик строит Actor по сессии (evaluatorActor) внутри run(): отказ — наш 403, а не 500.
export const tgAppEvRoutes = new Elysia({ name: "@api/kpi/tg-app-ev" })
  .use(ctx)
  .use(kpiTgCtx)
  // period проверяет сервис: кривой — наш 422 bad_period, а не ответ схемы.
  .get(
    "/kpi/tg/ev/employees",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvEmployees> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evEmployees(drizzle, actor, query.period, now());
      }),
    { query: t.Object({ period: t.Optional(t.Any()) }) }
  );
