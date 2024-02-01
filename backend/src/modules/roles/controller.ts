import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { roles } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const rolesController = new Elysia({
    name: "@api/roles"
})
    .use(ctx)
    .get('/roles', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('roles.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, roles, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, roles, {});
        }
        const rolesCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(roles)
            .where(and(...whereClause))
            .execute();
        const rolesList = await drizzle
            .select(selectFields)
            .from(roles)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute() as InferSelectModel<typeof roles>[];
        return {
            total: rolesCount[0].count,
            data: rolesList
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
    .get('/roles/cached', async ({ user, set, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('roles.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const rolesList = await cacheController.getCachedRoles({});
        return rolesList;
    })
    .get('/roles/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('roles.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const role = await drizzle
            .select()
            .from(roles)
            .where(eq(roles.id, id))
            .execute();
        if (!role.length) {
            set.status = 404;
            return {
                message: 'Role not found'
            };
        }
        return role[0];
    }, {
        params: t.Object({
            id: t.String()
        })
    })
    .post('/roles', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('roles.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const role = await drizzle
            .insert(roles)
            .values(data)
            .execute();
        await cacheController.cacheRoles();
        return role;
    }, {
        body: t.Object({
            data: t.Object({
                name: t.String(),
                code: t.Optional(t.Nullable(t.String())),
                active: t.Optional(t.Boolean()),
            })
        })
    })
    .put('/roles/:id', async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('roles.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const role = await drizzle
            .update(roles)
            .set(data)
            .where(eq(roles.id, id))
            .execute();
        await cacheController.cacheRoles();
        return role;
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            data: t.Object({
                name: t.String(),
                code: t.Optional(t.Nullable(t.String())),
                active: t.Optional(t.Boolean()),
            })
        })
    })
    .delete('/roles/:id', async ({ params: { id }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('roles.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }


        const role = await drizzle
            .delete(roles)
            .where(eq(roles.id, id))
            .execute();
        await cacheController.cacheRoles();
        return role;
    }, {
        params: t.Object({
            id: t.String()
        })
    })