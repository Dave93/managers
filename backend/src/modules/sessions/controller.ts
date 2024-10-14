import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { sessions } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const sessionController = new Elysia({
  name: "@api/sessions",
})
  .use(ctx)
  .get(
    "/sessions",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
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
        data: sessionsList,
      };
    },
    {
      permission: "sessions.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/sessions",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      const session = await drizzle.insert(sessions).values(data).execute();
      return {
        data: session,
      };
    },
    {
      permission: "sessions.add",
      body: t.Object({
        data: t.Object({
          user_id: t.String(),
          user_agent: t.String(),
          device_name: t.String(),
        }),
      }),
    }
  )
  .get(
    "/sessions/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      const session = await drizzle
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .execute();
      return {
        data: session,
      };
    },
    {
      permission: "sessions.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .put(
    "/sessions/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      await drizzle
        .update(sessions)
        .set(data)
        .where(eq(sessions.id, id))
        .execute();

      return {
        data,
      };
    },
    {
      permission: "sessions.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          user_id: t.Optional(t.String()),
          user_agent: t.Optional(t.String()),
          device_name: t.Optional(t.String()),
        }),
      }),
    }
  )
  .delete(
    "/sessions/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      await drizzle.delete(sessions).where(eq(sessions.id, id)).execute();
      return {
        id,
      };
    },
    {
      permission: "sessions.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
