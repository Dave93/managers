import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { work_schedules } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const workSchedulesController = new Elysia({
    name: "@api/work_schedule",
})
    .use(ctx)
    .get('/work_schedule', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('work_schedule.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
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
            data: work_scheduleList
        };
    }, {
        query: t.Object({
            limit: t.String(),
            offset: t.String(),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })
    .post('/work_schedule', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('work_schedule.create')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const work_scheduleId = await drizzle
            .insert(work_schedules)
            .values(data)
            .execute();
        await cacheController.cacheWorkSchedules();
        return {
            data: work_scheduleId
        };
    }, {
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
                    default: 0
                }),
            })
        })
    })
    .get('/work_schedule/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('work_schedule.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const work_scheduleList = await drizzle
            .select()
            .from(work_schedules)
            .where(eq(work_schedules.id, id))
            .execute();

        return {
            data: work_scheduleList
        };
    })
    .put('/work_schedule/:id', async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('work_schedule.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const work_scheduleList = await drizzle
            .update(work_schedules)
            .set(data)
            .where(eq(work_schedules.id, id))
            .execute();
        await cacheController.cacheWorkSchedules();
        return {
            data: work_scheduleList
        };
    }, {
        params: t.Object({
            id: t.String()
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
                    default: 0
                }),
            })
        })
    })
    .delete('/work_schedule/:id', async ({ params: { id }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('work_schedule.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        await drizzle
            .delete(work_schedules)
            .where(eq(work_schedules.id, id))
            .execute();
        await cacheController.cacheWorkSchedules();
        return {
            data: true
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })