import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, has, requireAny } from "../access";
import { visibleCardedIds } from "../directory";
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

// Приглашения и статус привязки: HR (kpi.manage) — по всем; менеджер филиала (kpi.evaluate / kpi.view) —
// только по сотрудникам, которых он видит в KPI. Приглашения оценщикам (user_id) и отвязка остаются у HR.
const ACCESS = ["kpi.manage", "kpi.evaluate", "kpi.view"];

export const telegramRoutes = new Elysia({ name: "@api/kpi/telegram" })
  .use(ctx)
  .post(
    "/kpi/invites",
    async ({ body, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ACCESS);
        if (!has(actor, "kpi.manage")) {
          if (body.user_id !== undefined && body.user_id !== null) throw new KpiError(403, "forbidden");
          // Остальные значения проверит createInvite: неверное — его код ошибки.
          const id = body.employee_id;
          if (typeof id === "string" && UUID_RE.test(id) && !(await visibleCardedIds(drizzle, actor, [id])).has(id)) {
            throw new KpiError(404, "not_found");
          }
        }
        return createInvite(drizzle, user!.id, { employee_id: body.employee_id, user_id: body.user_id });
      }),
    {
      userAuth: true,
      // Значения проверяет сервис: неверное — наш код ошибки, а не ответ схемы.
      body: t.Object({ employee_id: t.Optional(t.Any()), user_id: t.Optional(t.Any()) }),
    }
  )
  .get(
    "/kpi/tg/bindings",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ACCESS);
        let employee_ids = parseIds(query.employee_ids);
        let user_ids = parseIds(query.user_ids);
        if (!has(actor, "kpi.manage")) {
          if (user_ids.length) throw new KpiError(403, "forbidden");
          // Чужих сотрудников молча отбрасываем: по статусу привязки нельзя узнать, есть ли такой человек.
          const visible = await visibleCardedIds(drizzle, actor, employee_ids);
          employee_ids = employee_ids.filter((id) => visible.has(id));
          user_ids = [];
        }
        return listBindings(drizzle, { employee_ids, user_ids });
      }),
    {
      userAuth: true,
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
