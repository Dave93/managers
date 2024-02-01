import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { users_roles } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const usersRolesController = new Elysia({
    name: "@api/users_roles",
})
    .use(ctx)
    .get('/users_roles', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_roles.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, users_roles, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, users_roles, {});
        }
        const users_rolesCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(users_roles)
            .where(and(...whereClause))
            .execute();
        const users_rolesList = await drizzle
            .select(selectFields)
            .from(users_roles)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute() as InferSelectModel<typeof users_roles>[];

        return {
            total: users_rolesCount[0].count,
            data: users_rolesList
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
    .post('/users_roles', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_roles.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const users_rolesList = await drizzle
            .insert(users_roles)
            .values(data)
            .execute();
        return {
            data: users_rolesList
        };
    }, {
        body: t.Object({
            data: t.Array(t.Object({
                user_id: t.String(),
                role_id: t.String(),
            }))
        })
    })
    .post('/users_roles/assign_roles', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_roles.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        await drizzle.delete(users_roles).where(eq(users_roles.user_id, data.user_id)).execute();

        const users_rolesList = await drizzle
            .insert(users_roles)
            .values(data.role_id.map(item => ({
                user_id: data.user_id,
                role_id: item
            })))
            .execute();
        return {
            data: users_rolesList
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                role_id: t.Array(t.String()),
            })
        })
    })