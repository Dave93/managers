import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { terminals } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const terminalsController = new Elysia({
  name: "@api/terminals",
})
  .use(ctx)
  .get(
    "/terminals",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("terminals.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, terminals, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, terminals, {});
      }
      const terminalsCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(terminals)
        .where(and(...whereClause))
        .execute();
      const terminalsList = (await drizzle
        .select(selectFields)
        .from(terminals)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof terminals>[];

      return {
        total: terminalsCount[0].count,
        data: terminalsList,
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
  .post(
    "/terminals",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("terminals.add")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const newTerminals = await drizzle
        .insert(terminals)
        .values(data)
        .execute();
      await cacheController.cacheTerminals();
      return {
        data: newTerminals,
      };
    },
    {
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
        }),
      }),
    }
  )
  .get("/terminals/cached", async ({ user, set, cacheController }) => {
    if (!user) {
      set.status = 401;
      return {
        message: "User not found",
      };
    }
    if (!user.permissions.includes("terminals.list")) {
      set.status = 401;
      return {
        message: "You don't have permissions",
      };
    }
    const cachedTerminals = await cacheController.getCachedTerminals({});
    return cachedTerminals;
  })
  .get("/terminals/:id", async ({ params: { id }, user, set, drizzle }) => {
    if (!user) {
      set.status = 401;
      return {
        message: "User not found",
      };
    }
    if (!user.permissions.includes("terminals.one")) {
      set.status = 401;
      return {
        message: "You don't have permissions",
      };
    }
    const terminal = await drizzle
      .select()
      .from(terminals)
      .where(eq(terminals.id, id))
      .execute();
    if (!terminal.length) {
      set.status = 404;
      return {
        message: "Terminal not found",
      };
    }
    return terminal[0];
  })
  .put(
    "/terminals/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("terminals.edit")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const terminal = await drizzle
        .update(terminals)
        .set(data)
        .where(eq(terminals.id, id))
        .execute();
      await cacheController.cacheTerminals();
      return {
        data: terminal,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
        }),
      }),
    }
  )
  .delete(
    "/terminals/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("terminals.delete")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      await drizzle.delete(terminals).where(eq(terminals.id, id)).execute();
      await cacheController.cacheTerminals();
      return {
        data: "OK",
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
