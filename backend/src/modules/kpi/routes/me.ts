import { ctx } from "@backend/context";
import { kpi_cards, kpi_evaluator_scopes, terminals, users } from "backend/drizzle/schema";
import { asc, eq } from "drizzle-orm";
import Elysia from "elysia";
import { actorFrom, requireAny } from "../access";
import { now } from "../clock";
import { run } from "../errors";
import { iso } from "../iso";
import { loadSettings } from "../settings";
import { disputeDeadline, currentReviewPeriod, reviewDeadline, submitOpensAt } from "../time";
import { KPI_PERMS, type Deadlines, type KpiPerm, type MeResponse, type ScopeRow } from "../types";

export const meRoutes = new Elysia({ name: "@api/kpi/me" })
  .use(ctx)
  .get(
    "/kpi/me",
    async ({ user, role, terminals: userTerminals, drizzle, cacheController, set }) =>
      run(set, async (): Promise<MeResponse> => {
        const actor = await actorFrom({ user, role, terminals: userTerminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        const settings = await loadSettings(drizzle);
        const period = currentReviewPeriod(now(), settings.review_deadline_day);
        const deadlines: Deadlines = {
          period,
          submit_opens_at: submitOpensAt(period).toISOString(),
          review_deadline: reviewDeadline(period, settings.review_deadline_day).toISOString(),
          dispute_deadline: disputeDeadline(period, settings.dispute_deadline_day).toISOString(),
        };
        const scopeRows = await drizzle
          .select({
            id: kpi_evaluator_scopes.id,
            user_id: kpi_evaluator_scopes.user_id,
            first_name: users.first_name,
            last_name: users.last_name,
            login: users.login,
            card_id: kpi_evaluator_scopes.card_id,
            card_title: kpi_cards.title_ru,
            terminal_id: kpi_evaluator_scopes.terminal_id,
            terminal_name: terminals.name,
            created_at: kpi_evaluator_scopes.created_at,
          })
          .from(kpi_evaluator_scopes)
          .leftJoin(users, eq(users.id, kpi_evaluator_scopes.user_id))
          .leftJoin(kpi_cards, eq(kpi_cards.id, kpi_evaluator_scopes.card_id))
          .leftJoin(terminals, eq(terminals.id, kpi_evaluator_scopes.terminal_id))
          .where(eq(kpi_evaluator_scopes.user_id, actor.userId))
          .orderBy(asc(kpi_evaluator_scopes.created_at));
        const scopes: ScopeRow[] = scopeRows.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          user_name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.login || "",
          card_id: r.card_id,
          card_title: r.card_title,
          terminal_id: r.terminal_id,
          terminal_name: r.terminal_name,
          created_at: iso(r.created_at),
        }));
        return {
          user_id: actor.userId,
          perms: KPI_PERMS.filter((p): p is KpiPerm => actor.perms.has(p)),
          is_hq: actor.isHq,
          scopes,
          settings,
          current_period: period,
          deadlines,
        };
      }),
    { userAuth: true }
  );
