import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { reports_status } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { InferSelectModel } from "drizzle-orm";

export const reportsStatusController = new Elysia({
    name: "@api/reports_status"
})
    .use(ctx)
    .get('/reports_status', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, reports_status, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, reports_status, {});
        }
        const reports_statusCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(reports_status)
            .where(and(...whereClause))
            .execute();
        const reports_statusList = await drizzle
            .select(selectFields)
            .from(reports_status)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute() as InferSelectModel<typeof reports_status>[];
        return {
            total: reports_statusCount[0].count,
            data: reports_statusList
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
    .get('/reports_status/cached', async ({ user, set, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const reports_statusList = await cacheController.getCachedReportStatuses({});
        return reports_statusList;
    })
    .get('/reports_status/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const reports_statusList = await drizzle
            .select()
            .from(reports_status)
            .where(eq(reports_status.id, id))
            .execute();
        if (reports_statusList.length === 0) {
            set.status = 404;
            return {
                message: 'Not found'
            };
        }
        return reports_statusList[0];
    })
    .post('/reports_status', async ({ body: { data }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const reports_statusList = await drizzle
            .insert(reports_status)
            .values(data)
            .execute();
        return reports_statusList[0];
    }, {
        body: t.Object({
            data: t.Object({
                code: t.String(),
                label: t.String(),
                color: t.String()
            })
        })
    })
    .put('/reports_status/:id', async ({ params: { id }, body: { data }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const reports_statusList = await drizzle
            .update(reports_status)
            .set(data)
            .where(eq(reports_status.id, id))
            .execute();
        return reports_statusList[0];
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            data: t.Object({
                code: t.Optional(t.String()),
                label: t.Optional(t.String()),
                color: t.Optional(t.String())
            })
        })
    })
    .delete('/reports_status/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('reports_status.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        await drizzle
            .delete(reports_status)
            .where(eq(reports_status.id, id))
            .execute();
        set.status = 204;
        return;
    }, {
        params: t.Object({
            id: t.String()
        })
    });