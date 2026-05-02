import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import {
  sales_plans,
  sales_plan_items,
  sales_plan_stats,
  terminals,
  credentials,
} from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, inArray } from "drizzle-orm";
import Elysia, { t } from "elysia";

export const salesPlansController = new Elysia({
  name: "@api/sales_plans",
})
  .use(ctx)

  // ─── CRUD: List plans ───
  .get(
    "/sales_plans",
    async ({ query: { limit, offset, filters }, drizzle }) => {
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, sales_plans, { terminals });
      }

      const countResult = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(sales_plans)
        .where(and(...whereClause))
        .execute();

      const plansList = await drizzle
        .select({
          id: sales_plans.id,
          terminal_id: sales_plans.terminal_id,
          organization_id: sales_plans.organization_id,
          year: sales_plans.year,
          month: sales_plans.month,
          created_by: sales_plans.created_by,
          created_at: sales_plans.created_at,
          updated_at: sales_plans.updated_at,
          terminal_name: terminals.name,
        })
        .from(sales_plans)
        .leftJoin(terminals, eq(sales_plans.terminal_id, terminals.id))
        .where(and(...whereClause))
        .orderBy(sql`${sales_plans.year} DESC, ${sales_plans.month} DESC`)
        .limit(+limit)
        .offset(+offset)
        .execute();

      // For each plan, count items and compute overall progress
      const planIds = plansList.map((p) => p.id);
      let itemCounts: Record<string, number> = {};
      let progressMap: Record<string, { total_planned: number; total_sold: number }> = {};

      if (planIds.length > 0) {
        const counts = await drizzle
          .select({
            plan_id: sales_plan_items.plan_id,
            count: sql<number>`count(*)`,
          })
          .from(sales_plan_items)
          .where(inArray(sales_plan_items.plan_id, planIds))
          .groupBy(sales_plan_items.plan_id)
          .execute();

        for (const c of counts) {
          itemCounts[c.plan_id] = Number(c.count);
        }

        const progress = await drizzle
          .select({
            plan_id: sales_plan_items.plan_id,
            total_planned: sql<number>`sum(${sales_plan_items.planned_qty})`,
            total_sold: sql<number>`coalesce(sum(${sales_plan_stats.sold_qty}), 0)`,
          })
          .from(sales_plan_items)
          .leftJoin(
            sales_plan_stats,
            eq(sales_plan_items.id, sales_plan_stats.plan_item_id)
          )
          .where(inArray(sales_plan_items.plan_id, planIds))
          .groupBy(sales_plan_items.plan_id)
          .execute();

        for (const p of progress) {
          progressMap[p.plan_id] = {
            total_planned: Number(p.total_planned),
            total_sold: Number(p.total_sold),
          };
        }
      }

      const data = plansList.map((plan) => ({
        ...plan,
        items_count: itemCounts[plan.id] || 0,
        total_planned: progressMap[plan.id]?.total_planned || 0,
        total_sold: progressMap[plan.id]?.total_sold || 0,
        progress_pct:
          progressMap[plan.id]?.total_planned > 0
            ? Math.round(
                (progressMap[plan.id].total_sold / progressMap[plan.id].total_planned) * 100
              )
            : 0,
      }));

      return { total: countResult[0].count, data };
    },
    // Note: After deploying, seed these permissions in the database:
    // INSERT INTO permissions (slug, description, active) VALUES
    //   ('sales_plans.list', 'View sales plans list', true),
    //   ('sales_plans.one', 'View single sales plan', true),
    //   ('sales_plans.add', 'Create sales plan', true),
    //   ('sales_plans.edit', 'Edit sales plan', true),
    //   ('sales_plans.delete', 'Delete sales plan', true),
    //   ('sales_plans.dashboard', 'View sales plan dashboard', true);
    // Then assign them to appropriate roles via roles_permissions table.
    {
      permission: "sales_plans.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        filters: t.Optional(t.String()),
      }),
    }
  )

  // ─── Tauri App: Get daily plan for terminal (Bearer token auth) ───
  .get(
    "/sales_plans/daily/:terminal_id",
    async ({
      // @ts-ignore
      headers,
      params: { terminal_id },
      set,
      drizzle,
      cacheController,
    }) => {
      console.log(`[sales_plans/daily] Request for terminal_id (iiko_id): ${terminal_id}`);

      const accessToken = headers["authorization"]?.split(" ")[1];
      if (!accessToken) {
        set.status = 401;
        return { message: "Token not found" };
      }

      const apiTokens = await cacheController.getCachedApiTokens({});
      const token = apiTokens.find((item: any) => item.token === accessToken);

      if (!token || !token.active) {
        set.status = 401;
        return { message: "Token not found or not active" };
      }

      // Resolve iiko_id to internal terminal_id
      const credentialResult = await drizzle
        .select({ model_id: credentials.model_id })
        .from(credentials)
        .where(
          and(
            eq(credentials.model, "terminals"),
            eq(credentials.type, "iiko_id"),
            eq(credentials.key, terminal_id)
          )
        )
        .execute();

      console.log(`[sales_plans/daily] Credential lookup result:`, JSON.stringify(credentialResult));

      if (credentialResult.length === 0) {
        console.log(`[sales_plans/daily] Terminal not found by iiko_id: ${terminal_id}`);
        set.status = 404;
        return { message: "Terminal not found by iiko_id" };
      }

      const realTerminalId = credentialResult[0].model_id;
      console.log(`[sales_plans/daily] Resolved realTerminalId: ${realTerminalId}`);

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const daysInMonth = new Date(year, month, 0).getDate();
      const currentDay = now.getDate();
      const daysRemaining = daysInMonth - currentDay + 1; // including today

      const planResults = await drizzle
        .select()
        .from(sales_plans)
        .where(
          and(
            eq(sales_plans.terminal_id, realTerminalId),
            eq(sales_plans.year, year),
            eq(sales_plans.month, month)
          )
        )
        .execute();

      console.log(`[sales_plans/daily] Plan query for terminal=${realTerminalId}, year=${year}, month=${month}, found=${planResults.length}`);

      if (planResults.length === 0) {
        console.log(`[sales_plans/daily] No plan found for terminal=${realTerminalId}, year=${year}, month=${month}`);
        set.status = 404;
        return { message: "No plan for this terminal and month" };
      }

      const plan = planResults[0];
      console.log(`[sales_plans/daily] Found plan id=${plan.id}`);

      const items = await drizzle
        .select()
        .from(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, plan.id))
        .execute();

      console.log(`[sales_plans/daily] Plan items count: ${items.length}`, JSON.stringify(items.map(i => ({ id: i.id, product_id: i.product_id, product_name: i.product_name, planned_qty: i.planned_qty }))));

      // Get sold quantities for this month
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

      const statsResults = await drizzle
        .select({
          plan_item_id: sales_plan_stats.plan_item_id,
          total_sold: sql<number>`coalesce(sum(${sales_plan_stats.sold_qty}), 0)`,
        })
        .from(sales_plan_stats)
        .where(
          and(
            eq(sales_plan_stats.plan_id, plan.id),
            eq(sales_plan_stats.terminal_id, realTerminalId),
            sql`${sales_plan_stats.date} >= ${monthStart}`,
            sql`${sales_plan_stats.date} <= ${monthEnd}`
          )
        )
        .groupBy(sales_plan_stats.plan_item_id)
        .execute();

      console.log(`[sales_plans/daily] Stats results count: ${statsResults.length}`, JSON.stringify(statsResults));

      const soldMap: Record<string, number> = {};
      for (const s of statsResults) {
        soldMap[s.plan_item_id] = Number(s.total_sold);
      }

      const responseItems = items.map((item) => {
        const soldThisMonth = soldMap[item.id] || 0;
        const remaining = item.planned_qty - soldThisMonth;
        const dailyTarget = daysRemaining > 0 ? Math.ceil(Math.max(remaining, 0) / daysRemaining) : 0;

        return {
          item_id: item.id,
          product_id: item.product_id,
          product_name: item.product_name,
          monthly_target: item.planned_qty,
          sold_this_month: soldThisMonth,
          daily_target: dailyTarget,
        };
      });

      console.log(`[sales_plans/daily] Response items count: ${responseItems.length}`);

      return {
        plan_id: plan.id,
        year,
        month,
        days_in_month: daysInMonth,
        days_remaining: daysRemaining,
        items: responseItems,
      };
    },
    {
      params: t.Object({ terminal_id: t.String() }),
    }
  )

  // ─── CRUD: Get single plan with items ───
  .get(
    "/sales_plans/:id",
    async ({ params: { id }, drizzle, set }) => {
      const planResults = await drizzle
        .select({
          id: sales_plans.id,
          terminal_id: sales_plans.terminal_id,
          organization_id: sales_plans.organization_id,
          year: sales_plans.year,
          month: sales_plans.month,
          created_by: sales_plans.created_by,
          created_at: sales_plans.created_at,
          terminal_name: terminals.name,
        })
        .from(sales_plans)
        .leftJoin(terminals, eq(sales_plans.terminal_id, terminals.id))
        .where(eq(sales_plans.id, id))
        .execute();

      if (planResults.length === 0) {
        set.status = 404;
        return { message: "Plan not found" };
      }

      const items = await drizzle
        .select()
        .from(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, id))
        .execute();

      return { ...planResults[0], items };
    },
    {
      permission: "sales_plans.one",
      params: t.Object({ id: t.String() }),
    }
  )

  // ─── CRUD: Create plan with items ───
  .post(
    "/sales_plans",
    async ({ body, drizzle, user, set }) => {
      // Check for duplicate
      const existing = await drizzle
        .select({ id: sales_plans.id })
        .from(sales_plans)
        .where(
          and(
            eq(sales_plans.terminal_id, body.terminal_id),
            eq(sales_plans.year, body.year),
            eq(sales_plans.month, body.month)
          )
        )
        .execute();

      if (existing.length > 0) {
        set.status = 400;
        return { message: "Plan already exists for this terminal and month" };
      }

      const inserted = await drizzle
        .insert(sales_plans)
        .values({
          terminal_id: body.terminal_id,
          organization_id: body.organization_id,
          year: body.year,
          month: body.month,
          created_by: user?.id,
        })
        .returning()
        .execute();

      const plan = inserted[0];

      if (body.items && body.items.length > 0) {
        await drizzle
          .insert(sales_plan_items)
          .values(
            body.items.map((item: any) => ({
              plan_id: plan.id,
              product_id: item.product_id,
              product_name: item.product_name,
              planned_qty: item.planned_qty,
            }))
          )
          .execute();
      }

      const items = await drizzle
        .select()
        .from(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, plan.id))
        .execute();

      return { ...plan, items };
    },
    {
      permission: "sales_plans.add",
      body: t.Object({
        terminal_id: t.String(),
        organization_id: t.String(),
        year: t.Number(),
        month: t.Number(),
        items: t.Array(
          t.Object({
            product_id: t.String(),
            product_name: t.String(),
            planned_qty: t.Number(),
          })
        ),
      }),
    }
  )

  // ─── CRUD: Copy plans to another month ───
  .post(
    "/sales_plans/copy",
    async ({ body, drizzle, user }) => {
      const { source_plan_ids, target_year, target_month } = body;

      // 1. Load source plans
      const sources = await drizzle
        .select({
          id: sales_plans.id,
          terminal_id: sales_plans.terminal_id,
          organization_id: sales_plans.organization_id,
        })
        .from(sales_plans)
        .where(inArray(sales_plans.id, source_plan_ids))
        .execute();

      const foundIds = new Set(sources.map((s) => s.id));
      const skipped: {
        source_plan_id: string;
        terminal_id: string | null;
        reason: "exists" | "source_not_found";
      }[] = [];

      // 2. Not found
      for (const id of source_plan_ids) {
        if (!foundIds.has(id)) {
          skipped.push({ source_plan_id: id, terminal_id: null, reason: "source_not_found" });
        }
      }

      if (sources.length === 0) {
        return { created: [], skipped };
      }

      // 3. Conflicts: existing pairs (terminal_id, target_year, target_month)
      const sourceTerminalIds = sources.map((s) => s.terminal_id);
      const existing = await drizzle
        .select({ terminal_id: sales_plans.terminal_id })
        .from(sales_plans)
        .where(
          and(
            inArray(sales_plans.terminal_id, sourceTerminalIds),
            eq(sales_plans.year, target_year),
            eq(sales_plans.month, target_month)
          )
        )
        .execute();

      const conflictingTerminals = new Set(existing.map((e) => e.terminal_id));

      // 4. Within-request dedup (multiple source ids with same terminal_id)
      const seenTerminals = new Set<string>();
      const toCreate: typeof sources = [];
      for (const s of sources) {
        if (conflictingTerminals.has(s.terminal_id) || seenTerminals.has(s.terminal_id)) {
          skipped.push({
            source_plan_id: s.id,
            terminal_id: s.terminal_id,
            reason: "exists",
          });
          continue;
        }
        seenTerminals.add(s.terminal_id);
        toCreate.push(s);
      }

      if (toCreate.length === 0) {
        return { created: [], skipped };
      }

      // 5. Load items for all source plans being created — single query
      const sourceIdsToCreate = toCreate.map((s) => s.id);
      const sourceItems = await drizzle
        .select()
        .from(sales_plan_items)
        .where(inArray(sales_plan_items.plan_id, sourceIdsToCreate))
        .execute();

      const itemsBySource: Record<string, typeof sourceItems> = {};
      for (const item of sourceItems) {
        if (!itemsBySource[item.plan_id]) itemsBySource[item.plan_id] = [];
        itemsBySource[item.plan_id].push(item);
      }

      // 6. Transaction: insert plans + items
      const created: { id: string; terminal_id: string }[] = [];

      await drizzle.transaction(async (tx) => {
        for (const src of toCreate) {
          const inserted = await tx
            .insert(sales_plans)
            .values({
              terminal_id: src.terminal_id,
              organization_id: src.organization_id,
              year: target_year,
              month: target_month,
              created_by: user?.id,
            })
            .returning({ id: sales_plans.id })
            .execute();

          const newPlanId = inserted[0].id;
          created.push({ id: newPlanId, terminal_id: src.terminal_id });

          const items = itemsBySource[src.id] ?? [];
          if (items.length > 0) {
            await tx
              .insert(sales_plan_items)
              .values(
                items.map((it) => ({
                  plan_id: newPlanId,
                  product_id: it.product_id,
                  product_name: it.product_name,
                  planned_qty: it.planned_qty,
                }))
              )
              .execute();
          }
        }
      });

      return { created, skipped };
    },
    {
      permission: "sales_plans.add",
      body: t.Object({
        source_plan_ids: t.Array(t.String({ format: "uuid" }), { minItems: 1 }),
        target_year: t.Integer({ minimum: 2020, maximum: 2100 }),
        target_month: t.Integer({ minimum: 1, maximum: 12 }),
      }),
    }
  )

  // ─── CRUD: Update plan items ───
  .patch(
    "/sales_plans/:id",
    async ({ params: { id }, body, drizzle, set }) => {
      const planResults = await drizzle
        .select({ id: sales_plans.id })
        .from(sales_plans)
        .where(eq(sales_plans.id, id))
        .execute();

      if (planResults.length === 0) {
        set.status = 404;
        return { message: "Plan not found" };
      }

      // Delete old stats and items, then insert new ones
      await drizzle
        .delete(sales_plan_stats)
        .where(eq(sales_plan_stats.plan_id, id))
        .execute();

      await drizzle
        .delete(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, id))
        .execute();

      if (body.items && body.items.length > 0) {
        await drizzle
          .insert(sales_plan_items)
          .values(
            body.items.map((item: any) => ({
              plan_id: id,
              product_id: item.product_id,
              product_name: item.product_name,
              planned_qty: item.planned_qty,
            }))
          )
          .execute();
      }

      const now = new Date().toISOString();
      await drizzle
        .update(sales_plans)
        .set({ updated_at: now })
        .where(eq(sales_plans.id, id))
        .execute();

      const items = await drizzle
        .select()
        .from(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, id))
        .execute();

      return { id, items };
    },
    {
      permission: "sales_plans.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        items: t.Array(
          t.Object({
            product_id: t.String(),
            product_name: t.String(),
            planned_qty: t.Number(),
          })
        ),
      }),
    }
  )

  // ─── CRUD: Delete plan ───
  .delete(
    "/sales_plans/:id",
    async ({ params: { id }, drizzle, set }) => {
      const planResults = await drizzle
        .select({ id: sales_plans.id })
        .from(sales_plans)
        .where(eq(sales_plans.id, id))
        .execute();

      if (planResults.length === 0) {
        set.status = 404;
        return { message: "Plan not found" };
      }

      // Delete stats, items, then plan
      await drizzle
        .delete(sales_plan_stats)
        .where(eq(sales_plan_stats.plan_id, id))
        .execute();

      await drizzle
        .delete(sales_plan_items)
        .where(eq(sales_plan_items.plan_id, id))
        .execute();

      await drizzle
        .delete(sales_plans)
        .where(eq(sales_plans.id, id))
        .execute();

      return { success: true };
    },
    {
      permission: "sales_plans.delete",
      params: t.Object({ id: t.String() }),
    }
  )

  // ─── Tauri App: Bulk upsert stats (Bearer token auth) ───
  .post(
    "/sales_plan_stats/bulk",
    async ({
      // @ts-ignore
      headers,
      body,
      set,
      drizzle,
      cacheController,
    }) => {
      const accessToken = headers["authorization"]?.split(" ")[1];
      if (!accessToken) {
        set.status = 401;
        return { message: "Token not found" };
      }

      const apiTokens = await cacheController.getCachedApiTokens({});
      const token = apiTokens.find((item: any) => item.token === accessToken);

      if (!token || !token.active) {
        set.status = 401;
        return { message: "Token not found or not active" };
      }

      // Resolve iiko_id to internal terminal_id
      const credentialResult = await drizzle
        .select({ model_id: credentials.model_id })
        .from(credentials)
        .where(
          and(
            eq(credentials.model, "terminals"),
            eq(credentials.type, "iiko_id"),
            eq(credentials.key, body.terminal_id)
          )
        )
        .execute();

      if (credentialResult.length === 0) {
        set.status = 404;
        return { message: "Terminal not found by iiko_id" };
      }

      const realTerminalId = credentialResult[0].model_id;

      const now = new Date().toISOString();

      await drizzle.transaction(async (tx) => {
        for (const item of body.items) {
          await tx
            .insert(sales_plan_stats)
            .values({
              plan_id: body.plan_id,
              plan_item_id: item.plan_item_id,
              terminal_id: realTerminalId,
              date: body.date,
              sold_qty: item.sold_qty,
              updated_at: now,
            })
            .onConflictDoUpdate({
              target: [
                sales_plan_stats.plan_item_id,
                sales_plan_stats.terminal_id,
                sales_plan_stats.date,
              ],
              set: {
                sold_qty: sql`${item.sold_qty}`,
                updated_at: now,
              },
            })
            .execute();
        }
      });

      return { success: true, count: body.items.length };
    },
    {
      body: t.Object({
        plan_id: t.String(),
        terminal_id: t.String(),
        date: t.String(),
        items: t.Array(
          t.Object({
            plan_item_id: t.String(),
            sold_qty: t.Number(),
          })
        ),
      }),
    }
  )

  // ─── Dashboard: aggregated progress (session auth) ───
  .get(
    "/sales_plan_stats/dashboard",
    async ({ query: { year, month, terminal_id, organization_id }, drizzle }) => {
      const yr = Number(year);
      const mo = Number(month);
      const daysInMonth = new Date(yr, mo, 0).getDate();

      let planWhere: SQLWrapper[] = [
        eq(sales_plans.year, yr),
        eq(sales_plans.month, mo),
      ];
      if (terminal_id) {
        planWhere.push(eq(sales_plans.terminal_id, terminal_id));
      }
      if (organization_id) {
        planWhere.push(eq(sales_plans.organization_id, organization_id));
      }

      const plans = await drizzle
        .select({
          id: sales_plans.id,
          terminal_id: sales_plans.terminal_id,
          terminal_name: terminals.name,
        })
        .from(sales_plans)
        .leftJoin(terminals, eq(sales_plans.terminal_id, terminals.id))
        .where(and(...planWhere))
        .execute();

      if (plans.length === 0) {
        return { terminals: [] };
      }

      const planIds = plans.map((p) => p.id);

      // Get items with stats aggregated
      const itemsWithStats = await drizzle
        .select({
          plan_id: sales_plan_items.plan_id,
          item_id: sales_plan_items.id,
          product_id: sales_plan_items.product_id,
          product_name: sales_plan_items.product_name,
          planned_qty: sales_plan_items.planned_qty,
          total_sold: sql<number>`coalesce(sum(${sales_plan_stats.sold_qty}), 0)`,
          sold_today: sql<number>`coalesce(sum(case when (${sales_plan_stats.date})::date = (now() AT TIME ZONE 'Asia/Tashkent')::date then ${sales_plan_stats.sold_qty} else 0 end), 0)`,
        })
        .from(sales_plan_items)
        .leftJoin(
          sales_plan_stats,
          eq(sales_plan_items.id, sales_plan_stats.plan_item_id)
        )
        .where(inArray(sales_plan_items.plan_id, planIds))
        .groupBy(
          sales_plan_items.plan_id,
          sales_plan_items.id,
          sales_plan_items.product_id,
          sales_plan_items.product_name,
          sales_plan_items.planned_qty
        )
        .execute();

      // Get latest sync time per terminal
      const lastSyncResults = await drizzle
        .select({
          terminal_id: sales_plan_stats.terminal_id,
          last_sync: sql<string>`max(${sales_plan_stats.updated_at})`,
        })
        .from(sales_plan_stats)
        .where(inArray(sales_plan_stats.plan_id, planIds))
        .groupBy(sales_plan_stats.terminal_id)
        .execute();

      const lastSyncMap: Record<string, string> = {};
      for (const s of lastSyncResults) {
        lastSyncMap[s.terminal_id] = s.last_sync;
      }

      // Group items by plan
      const itemsByPlan: Record<string, typeof itemsWithStats> = {};
      for (const item of itemsWithStats) {
        if (!itemsByPlan[item.plan_id]) {
          itemsByPlan[item.plan_id] = [];
        }
        itemsByPlan[item.plan_id].push(item);
      }

      const now = new Date();
      const currentDay = now.getDate();
      const daysRemaining = daysInMonth - currentDay + 1;

      const terminalData = plans.map((plan) => {
        const planItems = itemsByPlan[plan.id] || [];
        const totalPlanned = planItems.reduce((s, i) => s + i.planned_qty, 0);
        const totalSold = planItems.reduce((s, i) => s + Number(i.total_sold), 0);
        const progressPct = totalPlanned > 0 ? Math.round((totalSold / totalPlanned) * 100) : 0;

        const products = planItems.map((item) => {
          const remaining = item.planned_qty - Number(item.total_sold);
          const dailyTarget = daysRemaining > 0 ? Math.ceil(Math.max(remaining, 0) / daysRemaining) : 0;

          return {
            item_id: item.item_id,
            product_name: item.product_name,
            monthly_target: item.planned_qty,
            daily_target: dailyTarget,
            sold_today: Number(item.sold_today),
            sold_month: Number(item.total_sold),
            progress_pct:
              item.planned_qty > 0
                ? Math.round((Number(item.total_sold) / item.planned_qty) * 100)
                : 0,
          };
        });

        return {
          terminal_id: plan.terminal_id,
          terminal_name: plan.terminal_name,
          plan_id: plan.id,
          items_count: planItems.length,
          total_planned: totalPlanned,
          total_sold: totalSold,
          progress_pct: progressPct,
          last_sync: lastSyncMap[plan.terminal_id] || null,
          products,
        };
      });

      return { terminals: terminalData };
    },
    {
      permission: "sales_plans.dashboard",
      query: t.Object({
        year: t.String(),
        month: t.String(),
        terminal_id: t.Optional(t.String()),
        organization_id: t.Optional(t.String()),
      }),
    }
  );
