import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny } from "../access";
import { run } from "../errors";
import { cancelViolation, createViolation, listViolations, normalizePhotos, photoFile } from "../violations";

const READ_PERMS = ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"];

export const violationsRoutes = new Elysia({ name: "@api/kpi/violations" })
  .use(ctx)
  .get(
    "/kpi/violations",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, READ_PERMS);
        return listViolations(drizzle, actor, query as any);
      }),
    {
      userAuth: true,
      query: t.Object({
        period: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        employee_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/kpi/violations",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate"]);
        return createViolation(drizzle, actor, {
          employee_id: body.employee_id as string,
          card_item_id: body.card_item_id,
          occurred_at: body.occurred_at,
          comment: body.comment as string,
          photos: normalizePhotos(body.photos),
        });
      }),
    {
      userAuth: true,
      type: "multipart/form-data",
      // Поля без схемных проверок: неверное значение — наш код ошибки, а не ответ схемы.
      body: t.Object({
        employee_id: t.Optional(t.String()),
        card_item_id: t.Optional(t.String()),
        occurred_at: t.Optional(t.String()),
        comment: t.Optional(t.String()),
        photos: t.Optional(t.Any()),
      }),
    }
  )
  .post(
    "/kpi/violations/:id/cancel",
    async ({ params, body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.approve"]);
        return cancelViolation(drizzle, actor, params.id, body.reason as string);
      }),
    {
      userAuth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.Optional(t.Any()) }),
    }
  )
  .get(
    "/kpi/violation-photos/:id/file",
    async ({ params, user, role, terminals, drizzle, cacheController, set }) => {
      const r = await run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, READ_PERMS);
        return photoFile(drizzle, actor, params.id);
      });
      if ("error" in r) return r;
      set.headers["content-type"] = r.mime;
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["cache-control"] = "private, max-age=3600";
      return Bun.file(r.path);
    },
    { userAuth: true, params: t.Object({ id: t.String() }) }
  );
