import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { terminals, users_terminals } from "@backend/../drizzle/schema";
import { sql, and, SQLWrapper, eq, InferSelectModel, getTableColumns } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { UsersTerminalsWithRelation } from "./dto/list.dto";

export const usersTerminalsController = new Elysia({
    name: '@api/users_terminals'
})
    .use(ctx)
    .get('/users_terminals', async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_terminals.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        let selectFields: SelectedFields = {};
        if (fields) {
            selectFields = parseSelectFields(fields, users_terminals, {});
        }
        let whereClause: (SQLWrapper | undefined)[] = [];
        if (filters) {
            whereClause = parseFilterFields(filters, users_terminals, {});
        }
        const users_terminalsCount = await drizzle
            .select({ count: sql<number>`count(*)` })
            .from(users_terminals)
            .where(and(...whereClause))
            .execute();
        const users_terminalsList = await drizzle
            .select(selectFields)
            .from(users_terminals)
            .where(and(...whereClause))
            .limit(+limit)
            .offset(+offset)
            .execute() as InferSelectModel<typeof users_terminals>[];

        return {
            total: users_terminalsCount[0].count,
            data: users_terminalsList
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
    .post('/users_terminals/assign_terminals', async ({ body: { data }, user, set, drizzle, cacheController }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_terminals.edit')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }

        await drizzle.delete(users_terminals).where(eq(users_terminals.user_id, data.user_id)).execute();

        const users_terminalsList = await drizzle
            .insert(users_terminals)
            .values(data.terminal_id.map((terminal_id: string) => ({
                user_id: data.user_id,
                terminal_id
            })))
            .execute();
        return {
            data: users_terminalsList
        };
    }, {
        body: t.Object({
            data: t.Object({
                user_id: t.String(),
                terminal_id: t.Array(t.String()),
            })
        })
    })
    .get('/users_terminals/my_terminals', async ({ user, set, drizzle }) => {
        if (!user) {
            set.status = 401;
            return {
                message: 'User not found'
            };
        }
        if (!user.permissions.includes('users_terminals.list')) {
            set.status = 401;
            return {
                message: "You don't have permissions"
            };
        }
        const users_terminalsList = await drizzle
            .select({
                ...getTableColumns(users_terminals),
                terminals: {
                    ...getTableColumns(terminals),
                }
            })
            .from(users_terminals)
            .where(eq(users_terminals.user_id, user.user.id))
            .leftJoin(terminals, eq(users_terminals.terminal_id, terminals.id))
            .execute() as UsersTerminalsWithRelation[];

        return {
            data: users_terminalsList
        };
    })