import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { users_work_schedules } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const usersWorkSchedulesController = new Elysia({
    name: "@api/users_work_schedules",
})
    .use(ctx)
    .get('/users_work_schedules', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_work_schedules.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, users_work_schedules, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, users_work_schedules, {});
        }
        const users_work_schedulesCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(users_work_schedules)
            .where(and(...whereClause))
            .execute();
        const users_work_schedulesList = await drizzle
            .select(selectFields)
            .from(users_work_schedules)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();

        return {
            total: users_work_schedulesCount[0].count,
            data: users_work_schedulesList
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
    .post('/users_work_schedules', async ({ body: { data }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('users_work_schedules.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const users_work_schedulesList = await drizzle
            .insert(users_work_schedules)
            .values(data)
            .execute();

        return {
            data: users_work_schedulesList
        };
    }, {
        body: t.Object({
            data:
                t.Object({
                    user_id: t.String(),
                    work_schedule_id: t.String(),
                })
        })
    })
    .post('/users_work_schedules/assign_work_schedules', async ({ body: { data }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_work_schedules.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        await drizzle.delete(users_work_schedules).where(eq(users_work_schedules.user_id, data.user_id)).execute();

        const users_work_schedulesList = await drizzle
            .insert(users_work_schedules)
            .values(data.work_schedule_id.map((work_schedule_id: string) => ({
                user_id: data.user_id,
                work_schedule_id
            })))
            .execute();
        return {
            data: users_work_schedulesList
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                work_schedule_id: t.Array(t.String()),
            })
        })
    })