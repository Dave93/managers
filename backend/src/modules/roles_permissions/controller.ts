import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { permissions, roles_permissions } from "backend/drizzle/schema";
import { SQLWrapper, sql, and, eq } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { RolesPermissionsRelation } from "./dto/roles_permissions.dto";

export const rolesPermissionsController = new Elysia({
  name: "@api/roles_permissions",
})
  .use(ctx)
  .get(
    "/roles_permissions",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, roles_permissions, {
          permissions,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, roles_permissions, {
          permissions,
        });
      }
      const roles_permissionsCount = await drizzle
        .select({ count: sql`count(*)` })
        .from(roles_permissions)
        .leftJoin(
          permissions,
          eq(roles_permissions.permission_id, permissions.id)
        )
        .where(and(...whereClause))
        .execute();
      const roles_permissionsList = (await drizzle
        .select(selectFields)
        .from(roles_permissions)
        .leftJoin(
          permissions,
          eq(roles_permissions.permission_id, permissions.id)
        )
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as RolesPermissionsRelation[];
      return {
        total: roles_permissionsCount[0].count,
        data: roles_permissionsList,
      };
    },
    {
      permission: "roles_permissions.list",
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
    "/roles_permissions",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      const role = await drizzle
        .insert(roles_permissions)
        .values(data)
        .execute();

      return role;
    },
    {
      permission: "roles_permissions.add",
      body: t.Object({
        data: t.Object({
          role_id: t.String(),
          permission_id: t.String(),
        }),
      }),
    }
  )
  .post(
    "/roles_permissions/assign_permissions",
    async ({
      body: { role_id, permissions_ids },
      user,
      drizzle,
      set,
      cacheController,
    }) => {
      await drizzle
        .delete(roles_permissions)
        .where(eq(roles_permissions.role_id, role_id))
        .execute();
      const res = await drizzle
        .insert(roles_permissions)
        .values(
          permissions_ids.map((perm) => ({
            role_id,
            permission_id: perm,
          }))
        )
        .returning();
      await cacheController.cacheRoles();
      return res;
    },
    {
      permission: "roles_permissions.edit",
      body: t.Object({
        role_id: t.String(),
        permissions_ids: t.Array(t.String()),
      }),
    }
  );
