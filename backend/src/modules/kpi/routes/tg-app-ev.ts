import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { now } from "../clock";
import { run } from "../errors";
import type { ItemInput } from "../reviews";
import { kpiTgCtx } from "../tg-app/ctx";
import { evaluatorActor } from "../tg-app/ev-actor";
import { evEmployees } from "../tg-app/ev-list";
import { evForm, evSaveDraft, evSubmit } from "../tg-app/ev-review";
import type { EvEmployees, EvReviewForm } from "../tg-app/ev-types";
import { itemsSchema } from "./reviews";

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
  )
  // period и employee_id проверяет сервис: мусор — наш 422 bad_period / bad_id, а не ответ схемы.
  .get(
    "/kpi/tg/ev/form",
    async ({ query, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evForm(drizzle, actor, query.period, query.employee_id);
      }),
    { query: t.Object({ period: t.Optional(t.Any()), employee_id: t.Optional(t.Any()) }) }
  )
  .put(
    "/kpi/tg/ev/draft",
    async ({ body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evSaveDraft(drizzle, actor, body);
      }),
    {
      body: t.Object({
        period: t.Optional(t.Any()),
        employee_id: t.Optional(t.Any()),
        items: t.Optional(itemsSchema),
      }),
    }
  )
  .post(
    "/kpi/tg/ev/reviews/:id/submit",
    async ({ params, body, tg, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EvReviewForm> => {
        const actor = await evaluatorActor(drizzle, cacheController, tg);
        return evSubmit(drizzle, actor, params.id, (body?.items ?? undefined) as ItemInput[] | undefined);
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ items: t.Optional(itemsSchema) })),
    }
  );
