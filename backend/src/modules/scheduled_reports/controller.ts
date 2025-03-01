import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { scheduled_reports } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const scheduledReportsController = new Elysia({
  name: "@api/scheduled_reports",
})
  .use(ctx)
  .get(
    "/scheduled_reports",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, scheduled_reports, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, scheduled_reports, {});
      }
      const scheduled_reportsCount = await drizzle
        .select({ count: sql`count(*)` })
        .from(scheduled_reports)
        .where(and(...whereClause))
        .execute();
      const scheduled_reportsList = await drizzle
        .select(selectFields)
        .from(scheduled_reports)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return {
        total: scheduled_reportsCount[0].count,
        data: scheduled_reportsList,
      };
    },
    {
      permission: "scheduled_reports.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/scheduled_reports",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      const scheduled_reportsId = await drizzle
        .insert(scheduled_reports)
        .values(data)
        .returning({
          id: scheduled_reports.id,
        })
        .execute();
      await cacheController.cacheScheduledReports();
      return {
        id: scheduled_reportsId[0],
      };
    },
    {
      permission: "scheduled_reports.add",
      body: t.Object({
        data: t.Object({
          name: t.String(),
          code: t.String(),
          cron: t.String(),
        }),
      }),
    }
  )
  .get(
    "/scheduled_reports/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      const scheduled_reportsList = await drizzle
        .select()
        .from(scheduled_reports)
        .where(eq(scheduled_reports.id, id))
        .execute();
      if (scheduled_reportsList.length === 0) {
        set.status = 404;
        return {
          message: "Scheduled report not found",
        };
      }
      return scheduled_reportsList[0];
    },
    {
      permission: "scheduled_reports.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .put(
    "/scheduled_reports/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      await drizzle
        .update(scheduled_reports)
        .set(data)
        .where(eq(scheduled_reports.id, id))
        .execute();
      await cacheController.cacheScheduledReports();
      return {
        id,
      };
    },
    {
      permission: "scheduled_reports.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          name: t.Optional(t.String()),
          code: t.Optional(t.String()),
          cron: t.Optional(t.String()),
        }),
      }),
    }
  )
  .delete(
    "/scheduled_reports/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      await drizzle
        .delete(scheduled_reports)
        .where(eq(scheduled_reports.id, id))
        .execute();
      await cacheController.cacheScheduledReports();
      return {
        id,
      };
    },
    {
      permission: "scheduled_reports.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
