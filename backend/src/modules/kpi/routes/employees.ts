import { ctx } from "@backend/context";
import { employees, kpi_cards, kpi_employee_cards } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { actorFrom, has, requireAny } from "../access";
import { now } from "../clock";
import { loadDirectory } from "../directory";
import { listEmployeeRows, setExternalId, UUID_RE } from "../employees";
import { KpiError, run } from "../errors";
import type { EmployeeRow } from "../types";

export const employeesRoutes = new Elysia({ name: "@api/kpi/employees" })
  .use(ctx)
  .get(
    "/kpi/employees",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async (): Promise<EmployeeRow[]> => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        // Список без карт нужен HR для настройки; остальным параметр не меняет ответ.
        const includeUncarded = has(actor, "kpi.manage") && (query.include_uncarded === "1" || query.include_uncarded === "true");
        return listEmployeeRows(drizzle, actor, query, { includeUncarded });
      }),
    {
      userAuth: true,
      query: t.Object({
        period: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        card_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        include_uncarded: t.Optional(t.String()),
      }),
    }
  )
  .put(
    "/kpi/employees/:id/card",
    async ({ params, body, user, drizzle, set }) =>
      run(set, async () => {
        const b = body as Record<string, unknown>;
        if (!UUID_RE.test(params.id)) throw new KpiError(404, "not_found");
        const [emp] = await drizzle.select({ id: employees.id }).from(employees).where(eq(employees.id, params.id)).limit(1);
        if (!emp) throw new KpiError(404, "not_found");
        const v = b.card_id;
        if (v !== null && (typeof v !== "string" || (v !== "auto" && !UUID_RE.test(v)))) {
          throw new KpiError(422, "unknown_card");
        }
        if (b.comment !== undefined && b.comment !== null && typeof b.comment !== "string") {
          throw new KpiError(422, "bad_comment");
        }
        const comment = typeof b.comment === "string" && b.comment.trim() !== "" ? b.comment.trim() : null;
        if (v === "auto") {
          await drizzle.delete(kpi_employee_cards).where(eq(kpi_employee_cards.employee_id, params.id));
        } else {
          if (v !== null) {
            const [c] = await drizzle
              .select({ id: kpi_cards.id })
              .from(kpi_cards)
              .where(and(eq(kpi_cards.id, v), eq(kpi_cards.active, true)))
              .limit(1);
            if (!c) throw new KpiError(422, "unknown_card");
          }
          const row = { employee_id: params.id, card_id: v, set_by: user!.id, set_at: now().toISOString(), comment };
          await drizzle
            .insert(kpi_employee_cards)
            .values(row)
            .onConflictDoUpdate({
              target: kpi_employee_cards.employee_id,
              set: { card_id: row.card_id, set_by: row.set_by, set_at: row.set_at, comment: row.comment },
            });
        }
        const [e] = await loadDirectory(drizzle, { employeeIds: [params.id], includeInactive: true });
        return e;
      }),
    {
      permission: "kpi.manage",
      params: t.Object({ id: t.String() }),
      body: t.Record(t.String(), t.Any()),
    }
  )
  .put(
    "/kpi/employees/:id/external-id",
    async ({ params, body, drizzle, set }) =>
      run(set, async () => setExternalId(drizzle, params.id, (body as Record<string, unknown>).external_id)),
    {
      permission: "kpi.manage",
      params: t.Object({ id: t.String() }),
      body: t.Record(t.String(), t.Any()),
    }
  );
