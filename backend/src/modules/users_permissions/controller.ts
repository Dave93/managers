import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { users_permissions } from "backend/drizzle/schema";
import { SQLWrapper, sql, and } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const usersPermissionsController = new Elysia({
    name: "@api/users_permissions",
})
    .use(ctx)
    .get('/users_permissions', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_permissions.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, users_permissions, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, users_permissions, {});
        }
        const users_permissionsCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(users_permissions)
            .where(and(...whereClause))
            .execute();
        const users_permissionsList = await drizzle
            .select(selectFields)
            .from(users_permissions)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();

        return {
            total: users_permissionsCount[0].count,
            data: users_permissionsList
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
    .post('/users_permissions', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_permissions.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const users_permissionsList = await drizzle
            .insert(users_permissions)
            .values(data)
            .execute();
        return {
            data: users_permissionsList
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                permission_id: t.String()
            })
        })
    })