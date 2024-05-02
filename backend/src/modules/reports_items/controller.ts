import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  report_groups,
  reports,
  reports_items,
  reports_status,
} from "backend/drizzle/schema";
import { sql, and, SQLWrapper, eq, desc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { ReportsItemsWithRelation } from "./dto/list.dto";

export const reportsItemsController = new Elysia({
  name: "@api/reports_items",
})
  .use(ctx)
  .get(
    "/reports_items",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports_items.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, reports_items, {
          report_groups,
          reports,
          reports_status,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, reports_items, {
          report_groups,
          reports,
          reports_status,
        });
      }
      const reports_itemsCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(reports_items)
        .where(and(...whereClause))
        .execute();
      const reports_itemsList = (await drizzle
        .select(selectFields)
        .from(reports_items)
        .where(and(...whereClause))
        .leftJoin(report_groups, eq(reports_items.group_id, report_groups.id))
        .leftJoin(reports, eq(reports_items.report_id, reports.id))
        .leftJoin(reports_status, eq(reports.status_id, reports_status.id))
        .limit(+limit)
        .offset(+offset)
        .orderBy(desc(reports_items.type))
        .execute()) as ReportsItemsWithRelation[];
      return {
        total: reports_itemsCount[0].count,
        data: reports_itemsList,
      };
    },
    {
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get("/reports_items/:id", async ({ params: { id }, user, set, drizzle }) => {
    if (!user) {
      set.status = 401;
      return {
        message: "User not found",
      };
    }
    if (!user.permissions.includes("reports_items.one")) {
      set.status = 401;
      return {
        message: "You don't have permissions",
      };
    }
    const reports_itemsList = await drizzle
      .select()
      .from(reports_items)
      .where(eq(reports_items.id, id))
      .execute();
    if (!reports_itemsList.length) {
      set.status = 404;
      return {
        message: "Reports_items not found",
      };
    }
    return reports_itemsList[0];
  })
  .post(
    "/reports_items",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports_items.add")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const reports_itemsList = await drizzle
        .insert(reports_items)
        // @ts-ignore
        .values(data)
        .execute();
      return reports_itemsList;
    },
    {
      body: t.Object({
        data: t.Object({
          report_id: t.String(),
          label: t.String(),
          type: t.Union([t.Literal("income"), t.Literal("outcome")]),
          amount: t.Optional(t.Number()),
          source: t.String(),
          group_id: t.String(),
          report_date: t.String(),
        }),
      }),
    }
  )
  .put(
    "/reports_items/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports_items.edit")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const reports_itemsList = await drizzle
        .update(reports_items)
        // @ts-ignore
        .set(data)
        .where(eq(reports_items.id, id))
        .returning({
          id: reports_items.id,
          report_id: reports_items.report_id,
        })
        .execute();
      const reportItem = reports_itemsList[0];
      const reportItems = await drizzle
        .select({
          amount: reports_items.amount,
        })
        .from(reports_items)
        .where(eq(reports_items.report_id, reportItem.report_id))
        .execute();
      // @ts-ignore
      const totalManagerPrice = reportItems.reduce((acc, item) => {
        // @ts-ignore
        return acc + item.amount;
      }, 0);

      const reportsList = await drizzle
        .select({
          total_amount: reports.total_amount,
        })
        .from(reports)
        .where(eq(reports.id, reportItem.report_id))
        .execute();

      const report = reportsList[0];

      let difference = 0;
      if (report?.total_amount) {
        // @ts-ignore
        difference = totalManagerPrice - report?.total_amount;
      }

      await drizzle
        .update(reports)
        .set({
          // @ts-ignore
          total_manager_price: totalManagerPrice,
          difference,
        })
        .where(eq(reports.id, reportItem.report_id))
        .execute();

      return reports_itemsList;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          report_id: t.Optional(t.String()),
          label: t.Optional(t.String()),
          type: t.Optional(
            t.Union([t.Literal("income"), t.Literal("outcome")])
          ),
          amount: t.Optional(t.Number()),
          source: t.Optional(t.String()),
          group_id: t.Optional(t.String()),
          report_date: t.Optional(t.String()),
        }),
      }),
    }
  )
  .delete(
    "/reports_items/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports_items.delete")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const reports_itemsList = await drizzle
        .delete(reports_items)
        .where(eq(reports_items.id, id))
        .execute();
      return reports_itemsList;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
