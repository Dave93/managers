import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { work_schedules } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

type WorkSchedeInsert = typeof work_schedules.$inferInsert;

export const workSchedulesController = new Elysia({
  name: "@api/work_schedule",
})
  .use(ctx)
  .get(
    "/work_schedule",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {
        id: work_schedules.id,
        name: work_schedules.name,
        active: work_schedules.active,
        organization_id: work_schedules.organization_id,
        days: work_schedules.days,
        start_time: work_schedules.start_time,
        end_time: work_schedules.end_time,
        max_start_time: work_schedules.max_start_time,
        bonus_price: work_schedules.bonus_price,
      };
      if (fields) {
        selectFields = parseSelectFields(fields, work_schedules, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, work_schedules, {});
      }
      const work_scheduleCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(work_schedules)
        .where(and(...whereClause))
        .execute();
      const work_scheduleList = await drizzle
        .select(selectFields)
        .from(work_schedules)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: work_scheduleCount[0].count,
        data: work_scheduleList,
      };
    },
    {
      permission: "work_schedule.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get("/work_schedule/cached", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle, cacheController }) => {
    const workSchedulesList = await cacheController.getCachedWorkSchedules({});

    
    return workSchedulesList;
  },
  {
    permission: "work_schedule.list",
  })
  
  .post(
    "/work_schedule",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      const insertDate: WorkSchedeInsert ={
        ...data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const work_schedulesy = await drizzle
        .insert(work_schedules)
        .values(insertDate)
        .execute();
      await cacheController.cachePermissions();
      await cacheController.cacheWorkSchedules();
      return {
          data: work_schedules,
      };
    },
    {
      permission: "work_schedule.add",
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          organization_id: t.String(),
          days: t.Array(t.String()),
          start_time: t.String(),
          end_time: t.String(),
          max_start_time: t.String(),
          bonus_price: t.Number({
            default: 0,
          }),
        }),
      }),
    }
  )
  .get(
    "/work_schedule/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      const work_scheduleList = await drizzle
        .select()
        .from(work_schedules)
        .where(eq(work_schedules.id, id))
        .execute();

      return {
        data: work_scheduleList,
      };
    },
    {
      permission: "work_schedule.one",
    }
  )
  .put(
    "/work_schedule/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      const work_scheduleList = await drizzle
        .update(work_schedules)
        .set(data)
        .where(eq(work_schedules.id, id))
        .execute();
      await cacheController.cacheWorkSchedules();
      return {
        data: work_scheduleList,
      };
    },
    {
      permission: "work_schedule.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          name: t.Optional(t.String()),
          active: t.Optional(t.Boolean()),
          organization_id: t.Optional(t.String()),
          days: t.Optional(t.Array(t.String())),
          start_time: t.Optional(t.String()),
          end_time: t.Optional(t.String()),
          max_start_time: t.String(),
          bonus_price: t.Number({
            default: 0,
          }),
        }),
      }),
    }
  )
  .delete(
    "/work_schedule/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      await drizzle
        .delete(work_schedules)
        .where(eq(work_schedules.id, id))
        .execute();
      await cacheController.cacheWorkSchedules();
      return {
        data: true,
      };
    },
    {
      permission: "work_schedule.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
