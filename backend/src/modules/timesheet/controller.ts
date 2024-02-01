import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { timesheet } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const timesheetController = new Elysia({
    name: "@api/timesheet",
})
    .use(ctx)
    .get('/timesheet', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('timesheet.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, timesheet, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, timesheet, {});
        }
        const timesheetCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(timesheet)
            .where(and(...whereClause))
            .execute();
        const timesheetList = await drizzle
            .select(selectFields)
            .from(timesheet)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();

        return {
            total: timesheetCount[0].count,
            data: timesheetList
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
    .post('/timesheet', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('timesheet.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const timesheetData = await drizzle
            .insert(timesheet)
            .values(data)
            .execute();

        return {
            data: timesheetData
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                is_late: t.Optional(t.Boolean()),
                date: t.String()
            })
        })
    })
    .get('/timesheet/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('timesheet.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const timesheetData = await drizzle
            .select()
            .from(timesheet)
            .where(eq(timesheet.id, id))
            .execute();

        return {
            data: timesheetData[0]
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })