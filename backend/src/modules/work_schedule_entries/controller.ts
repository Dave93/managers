import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { work_schedule_entries } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const workScheduleEntriesController = new Elysia({
    name: "@api/work_schedule_entries",
})
    .use(ctx)
    .get('/work_schedule_entries', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('work_schedule_entries.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, work_schedule_entries, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, work_schedule_entries, {});
        }
        const work_schedule_entriesCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(work_schedule_entries)
            .where(and(...whereClause))
            .execute();
        const work_schedule_entriesList = await drizzle
            .select(selectFields)
            .from(work_schedule_entries)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();

        return {
            total: work_schedule_entriesCount[0].count,
            data: work_schedule_entriesList
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
    .post('/work_schedule_entries', async ({ body: { data }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('work_schedule_entries.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const work_schedule_entriesList = await drizzle
            .insert(work_schedule_entries)
            .values(data)
            .execute();
        return {
            data: work_schedule_entriesList
        };
    }, {
        body: t.Object({
            data: t.Array(t.Object({
                work_schedule_id: t.String(),
                user_id: t.String(),
                date_start: t.String(),
                ip_open: t.String(),
                lat_open: t.Number(),
                lon_open: t.Number(),
                late: t.Optional(t.Boolean())
            }))
        })
    })
    .get('/work_schedule_entries/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('work_schedule_entries.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const work_schedule_entriesList = await drizzle
            .select()
            .from(work_schedule_entries)
            .where(eq(work_schedule_entries.id, id))
            .execute();

        return {
            data: work_schedule_entriesList
        };
    })