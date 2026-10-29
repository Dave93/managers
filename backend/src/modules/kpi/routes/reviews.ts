import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, parsePeriod, requireAny } from "../access";
import { KpiError, run } from "../errors";
import { changeReview, getForm, listReviews, reviewEvents, saveDraft, submitReview, type ItemInput } from "../reviews";

// score принимаем любым типом: неверное значение — наш 422 bad_score, а не ошибка схемы.
export const itemsSchema = t.Array(
  t.Object({
    item_id: t.String(),
    score: t.Optional(t.Any()),
    note: t.Optional(t.Union([t.String(), t.Null()])),
  })
);

const READ_PERMS = ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"];

export const reviewsRoutes = new Elysia({ name: "@api/kpi/reviews" })
  .use(ctx)
  .get(
    "/kpi/reviews",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, READ_PERMS);
        return listReviews(drizzle, actor, { ...query, period: query.period as string });
      }),
    {
      userAuth: true,
      query: t.Object({
        period: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        card_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/kpi/reviews/form",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, READ_PERMS);
        const period = parsePeriod(query.period);
        if (!query.employee_id) throw new KpiError(422, "bad_id");
        return getForm(drizzle, actor, period, query.employee_id);
      }),
    {
      userAuth: true,
      query: t.Object({ period: t.Optional(t.String()), employee_id: t.Optional(t.String()) }),
    }
  )
  .put(
    "/kpi/reviews/draft",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate"]);
        const period = parsePeriod(body.period);
        if (!body.employee_id) throw new KpiError(422, "bad_id");
        return saveDraft(drizzle, actor, period, body.employee_id, (body.items ?? []) as ItemInput[]);
      }),
    {
      userAuth: true,
      body: t.Object({
        period: t.Optional(t.String()),
        employee_id: t.Optional(t.String()),
        items: t.Optional(itemsSchema),
      }),
    }
  )
  .post(
    "/kpi/reviews/:id/submit",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate"]);
        return submitReview(drizzle, actor, params.id, (body?.items ?? undefined) as ItemInput[] | undefined);
      }),
    {
      userAuth: true,
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ items: t.Optional(itemsSchema) })),
    }
  )
  .put(
    "/kpi/reviews/:id",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.approve"]);
        return changeReview(drizzle, actor, params.id, (body.items ?? []) as ItemInput[], body.comment as string);
      }),
    {
      userAuth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({ items: t.Optional(itemsSchema), comment: t.Optional(t.Any()) }),
    }
  )
  .get(
    "/kpi/reviews/:id/events",
    async ({ params, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, READ_PERMS);
        return reviewEvents(drizzle, actor, params.id);
      }),
    { userAuth: true, params: t.Object({ id: t.String() }) }
  );
