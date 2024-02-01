import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { settings } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const settingsController = new Elysia({
    name: "@api/settings"
})
    .use(ctx)
    .get('/settings', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        console.log('filters', filters)
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('settings.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, settings, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, settings, {});
        }
        const settingsCount = await drizzle
            .select({ count: sql`count(*)` })
            .from(settings)
            .where(and(...whereClause))
            .execute();
        const settingsList = await drizzle
            .select(selectFields)
            .from(settings)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute() as InferSelectModel<typeof settings>[];

        settingsList.forEach((permission) => {
            if (permission.is_secure) {
                permission.value = "";
            }
        });
        return {
            total: settingsCount[0].count,
            data: settingsList
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
    .post('/settings', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('settings.add')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const settingsList = await drizzle
            .insert(settings)
            .values(data)
            .execute();
        await cacheController.cacheSettings();
        return {
            data: settingsList
        };
    }, {
        body: t.Object({
            data: t.Array(t.Object({
                key: t.String(),
                value: t.String(),
                is_secure: t.Optional(t.Boolean()),
            }))
        })
    })
    .post('/settings/:key', async ({ params: { key }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }

        const existingSettings = await drizzle
            .select()
            .from(settings)
            .where(eq(settings.key, key))
            .execute();

        let settingsList;

        if (!existingSettings.length) {


            settingsList = await drizzle
                .insert(settings)
                .values({
                    key,
                    value: data.value,
                    is_secure: data.is_secure
                })
                .onConflictDoUpdate({
                    target: settings.id, set: {
                        value: data.value,
                        is_secure: data.is_secure
                    }
                }).returning({
                    id: settings.id,
                    key: settings.key,
                    value: settings.value,
                    is_secure: settings.is_secure,
                }).execute();
        } else {
            settingsList = await drizzle
                .update(settings)
                .set({
                    value: data.value,
                    is_secure: data.is_secure
                })
                .where(eq(settings.key, key))
                .returning({
                    id: settings.id,
                    key: settings.key,
                    value: settings.value,
                    is_secure: settings.is_secure,
                })
                .execute();
        }
        await cacheController.cacheSettings();
        return {
            data: settingsList
        };
    }, {
        params: t.Object({
            key: t.String()
        }),
        body: t.Object({
            data: t.Object({
                value: t.String(),
                is_secure: t.Optional(t.Boolean()),
            })
        })
    })
    .get('/settings/:id', async ({ params: { id }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('settings.one')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const settingsList = await drizzle
            .select()
            .from(settings)
            .where(eq(settings.id, id))
            .execute();
        return {
            data: settingsList[0]
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })
    .put('/settings/:id', async ({ params: { id }, body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('settings.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const settingsList = await drizzle
            .update(settings)
            .set(data)
            .where(eq(settings.id, id))
            .execute();
        await cacheController.cacheSettings();
        return {
            data: settingsList
        };
    }, {
        params: t.Object({
            id: t.String()
        }),
        body: t.Object({
            data: t.Object({
                key: t.Optional(t.String()),
                value: t.Optional(t.String()),
                is_secure: t.Optional(t.Boolean()),
            })
        })
    })
    .delete('/settings/:id', async ({ params: { id }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('settings.delete')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        await drizzle
            .delete(settings)
            .where(eq(settings.id, id))
            .execute();
        await cacheController.cacheSettings();
        return {
            id
        };
    }, {
        params: t.Object({
            id: t.String()
        })
    })