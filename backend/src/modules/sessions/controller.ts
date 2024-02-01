import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { sessions } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const sessionController = new Elysia({
    name: "@api/sessions"
})
    .use(ctx)
    .get('/sessions', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('sessions.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, sessions, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, sessions, {});
        }
        const sessionsCount = await drizzle
            .select({ count: sql`count(*)` })
            .from(sessions)
            .where(and(...whereClause))
            .execute();
        const sessionsList = await drizzle
            .select(selectFields)
            .from(sessions)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();
        return {
            total: sessionsCount[0].count,
            data: sessionsList
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
    .post('/sessions', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('sessions.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const session = await drizzle
            .insert(sessions)
            .values(data)
            .execute();
        return {
            data: session
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                user_agent: t.String(),
                device_name: t.String()
            })
        })
    })
    .get('/sessions/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('sessions.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const session = await drizzle
            .select()
            .from(sessions)
            .where(eq(sessions.id, id))
            .execute();
        return {
            data: session
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })
    .put('/sessions/:id', async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('sessions.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        await drizzle
            .update(sessions)
            .set(data)
            .where(eq(sessions.id, id))
            .execute();

        return {
            data
        };
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            data: t.Object({
                user_id: t.Optional(t.String()),
                user_agent: t.Optional(t.String()),
                device_name: t.Optional(t.String())
            })
        })
    })
    .delete('/sessions/:id', async ({ params: { id }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('sessions.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        await drizzle
            .delete(sessions)
            .where(eq(sessions.id, id))
            .execute();
        return {
            id
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })