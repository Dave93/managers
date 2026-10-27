import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { UUID_RE } from "../employees";
import { KpiError, run } from "../errors";
import { createInvite, listBindings, unbind } from "../tg/bindings";

const MAX_IDS = 200;

// «a,b,c» → массив uuid; пустые части отбрасываются.
function parseIds(raw: string | undefined): string[] {
  const ids = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > MAX_IDS) throw new KpiError(422, "too_many_ids");
  if (ids.some((id) => !UUID_RE.test(id))) throw new KpiError(422, "bad_id");
  return ids;
}

export const telegramRoutes = new Elysia({ name: "@api/kpi/telegram" })
  .use(ctx)
  .post(
    "/kpi/invites",
    async ({ body, user, drizzle, set }) =>
      run(set, async () => createInvite(drizzle, user!.id, { employee_id: body.employee_id, user_id: body.user_id })),
    {
      permission: "kpi.manage",
      // Значения проверяет сервис: неверное — наш код ошибки, а не ответ схемы.
      body: t.Object({ employee_id: t.Optional(t.Any()), user_id: t.Optional(t.Any()) }),
    }
  )
  .get(
    "/kpi/tg/bindings",
    async ({ query, drizzle, set }) =>
      run(set, async () => listBindings(drizzle, { employee_ids: parseIds(query.employee_ids), user_ids: parseIds(query.user_ids) })),
    {
      permission: "kpi.manage",
      query: t.Object({ employee_ids: t.Optional(t.String()), user_ids: t.Optional(t.String()) }),
    }
  )
  .delete(
    "/kpi/tg/bindings/:id",
    async ({ params, drizzle, set }) =>
      run(set, async () => {
        await unbind(drizzle, params.id);
        return { ok: true as const };
      }),
    { permission: "kpi.manage", params: t.Object({ id: t.String() }) }
  );
