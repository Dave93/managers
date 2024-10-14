import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { permissions } from "backend/drizzle/schema";
import { sql, and, SQLWrapper, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const permissionsController = new Elysia({
  name: "@api/permissions",
})
  .use(ctx)
  .get(
    "/permissions",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, permissions, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, permissions, {});
      }
      const rolesCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(permissions)
        .where(and(...whereClause))
        .execute();
      const rolesList = (await drizzle
        .select(selectFields)
        .from(permissions)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof permissions>[];
      return {
        total: rolesCount[0].count,
        data: rolesList,
      };
    },
    {
      permission: "permissions.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/permissions/cached",
    async ({ user, set, drizzle, cacheController }) => {
      const rolesList = await cacheController.getCachedPermissions({});
      return {
        data: rolesList,
      };
    },
    {
      permission: "permissions.list",
    }
  )
  .get(
    "/permissions/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      const role = await drizzle
        .select()
        .from(permissions)
        .where(eq(permissions.id, id))
        .execute();
      if (!role.length) {
        set.status = 404;
        return {
          message: "Role not found",
        };
      }
      return role[0];
    },
    {
      permission: "permissions.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/permissions",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      const role = await drizzle.insert(permissions).values(data).execute();

      await cacheController.cachePermissions();
      return {
        data: role,
      };
    },
    {
      permission: "permissions.add",
      body: t.Object({
        data: t.Object({
          slug: t.String(),
          description: t.String(),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/permissions/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      const role = await drizzle
        .update(permissions)
        .set(data)
        .where(eq(permissions.id, id))
        .returning({
          id: permissions.id,
        })
        .execute();

      await cacheController.cachePermissions();
      return role[0];
    },
    {
      permission: "permissions.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          slug: t.Optional(t.String()),
          description: t.Optional(t.String()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/permissions/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      await drizzle.delete(permissions).where(eq(permissions.id, id)).execute();

      await cacheController.cachePermissions();
      return {
        message: "Role deleted",
      };
    },
    {
      permission: "permissions.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
