import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { product_groups } from "backend/drizzle/schema";
import { SQLWrapper, and, eq, sql } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const productGroupsController = new Elysia({
    name: '@api/product_groups'
})
    .use(ctx)
    .get('/product_groups', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('product_groups.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, product_groups, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, product_groups, {});
        }
        const product_groupsCount = await drizzle
            .select({ count: sql`count(*)` })
            .from(product_groups)
            .where(and(...whereClause))
            .execute();
        const product_groupsList = await drizzle
            .select(selectFields)
            .from(product_groups)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute();
        return {
            total: product_groupsCount[0].count,
            data: product_groupsList
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
    .get('/product_groups/cached', async ({ user, set, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('product_groups.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const product_groupsList = await cacheController.getCachedProductGroups({});
        return product_groupsList;
    })
    .get('/product_groups/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('product_groups.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const product_groupList = await drizzle
            .select()
            .from(product_groups)
            .where(eq(product_groups.id, id))
            .execute();
        if (!product_groupList.length) {
            set.status = 404;
            return {
                message: 'Product group not found'
            };
        }
        return product_groupList[0];
    }, {
        params: t.Object({
            id: t.String()
        })
    })
    .post('/product_groups', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('product_groups.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const product_groupList = await drizzle
            .insert(product_groups)
            .values(data)
            .execute();
        await cacheController.cacheProductGroups();
        return product_groupList;
    }, {
        body: t.Object({
            data: t.Object({
                name: t.String(),
                sort: t.Optional(t.Number()),
            })
        })
    })
    .put('/product_groups/:id', async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('product_groups.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const product_groupList = await drizzle
            .update(product_groups)
            .set(data)
            .where(eq(product_groups.id, id))
            .execute();
        await cacheController.cacheProductGroups();
        return product_groupList;
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            data: t.Object({
                name: t.Optional(t.String()),
                sort: t.Optional(t.Number()),
            })
        })
    })
    .delete('/product_groups/:id', async ({ params: { id }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        if (!user.permissions.includes('product_groups.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        const product_groupList = await drizzle
            .delete(product_groups)
            .where(eq(product_groups.id, id))
            .execute();
        await cacheController.cacheProductGroups();
        return product_groupList;
    }, {
        params: t.Object({
            id: t.String()
        })
    });