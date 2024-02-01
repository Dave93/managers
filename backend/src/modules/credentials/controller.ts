import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { credentials, organization } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, InferSelectModel, asc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t, NotFoundError } from "elysia";

export const credentialsController = new Elysia({
    name: "@api/credentials",
})
    .use(ctx)
    .get(
        "/credentials",
        async ({ query: { limit, offset, sort, filters, fields }, drizzle, user, set }) => {
            if (!user) {
                set.status = 401;
                return {
                    message: "User not found",
                };
            }

            if (!user.permissions.includes("credentials.list")) {
                set.status = 401;
                return {
                    message: "You don't have permissions",
                };
            }
            let selectFields: SelectedFields = {};
            if (fields) {
                selectFields = parseSelectFields(fields, credentials, {});
            }
            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, credentials, {});
            }
            const rolesCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(credentials)
                .where(and(...whereClause))
                .execute();
            const rolesList = await drizzle
                .select(selectFields)
                .from(credentials)
                .where(and(...whereClause))
                .limit(+limit)
                .offset(+offset)
                .orderBy(asc(credentials.key))
                .execute() as InferSelectModel<typeof credentials>[];
            return {
                total: rolesCount[0].count,
                data: rolesList,
            };
        },
        {
            query: t.Object({
                limit: t.String(),
                offset: t.String(),
                sort: t.Optional(t.String()),
                filters: t.Optional(t.String()),
                fields: t.Optional(t.String()),
            }),
        }
    )
    .get("/credentials/cached", async ({ redis }) => {
        const res = await redis.get(`${process.env.PROJECT_PREFIX}_credentials`);
        return JSON.parse(res || "[]") as InferSelectModel<typeof credentials>[];
    })
    .get(
        "/credentials/:id",
        async ({ params: { id }, drizzle, set, user }) => {
            if (!user) {
                set.status = 401;
                return {
                    message: "User not found",
                };
            }

            if (!user.permissions.includes("credentials.one")) {
                set.status = 401;
                return {
                    message: "You don't have permissions",
                };
            }
            const permissionsRecord = await drizzle
                .select()
                .from(credentials)
                .where(eq(credentials.id, id))
                .execute();
            if (!permissionsRecord.length) {
                throw new NotFoundError("credentials not found");
            }
            return permissionsRecord[0];
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        }
    )
    .post(
        "/credentials",
        async ({ body: { data }, drizzle, user, set, cacheController }) => {
            if (!user) {
                set.status = 401;
                return {
                    message: "User not found",
                };
            }

            if (!user.permissions.includes("credentials.add")) {
                set.status = 401;
                return {
                    message: "You don't have permissions",
                };
            }
            const credentialsRecord = await drizzle
                .insert(credentials)
                .values(data)
                .execute();
            await cacheController.cacheCredentials();
            return credentialsRecord[0];
        },
        {
            body: t.Object({
                data: t.Object({
                    model: t.String(),
                    type: t.String(),
                    key: t.String(),
                    model_id: t.String(),
                })
            }),
        }
    )
    .put(
        "/credentials/:id",
        async ({ params: { id }, body: { data }, drizzle, user, set, cacheController }) => {
            if (!user) {
                set.status = 401;
                return {
                    message: "User not found",
                };
            }

            if (!user.permissions.includes("credentials.edit")) {
                set.status = 401;
                return {
                    message: "You don't have permissions",
                };
            }
            const credentialsRecord = await drizzle
                .update(credentials)
                .set(data)
                .where(eq(credentials.id, id))
                .execute();
            await cacheController.cacheCredentials();
            return credentialsRecord[0];
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                data: t.Object({
                    model: t.String(),
                    type: t.String(),
                    key: t.String(),
                    model_id: t.String(),
                })
            }),
        }
    )
    .delete(
        "/credentials/:id",
        async ({ params: { id }, drizzle, user, set, cacheController }) => {
            if (!user) {
                set.status = 401;
                return {
                    message: "User not found",
                };
            }

            if (!user.permissions.includes("credentials.delete")) {
                set.status = 401;
                return {
                    message: "You don't have permissions",
                };
            }
            const credentialsRecord = await drizzle
                .delete(credentials)
                .where(eq(credentials.id, id))
                .execute();
            await cacheController.cacheCredentials();
            return credentialsRecord[0];
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        }
    )