import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { organization } from "backend/drizzle/schema";
import { sql, and, SQLWrapper, eq, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const organizationController = new Elysia({
  name: "@api/organization",
})
  .use(ctx)
  .get(
    "/organization",
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
      if (!user.permissions.includes("organizations.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, organization, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, organization, {});
      }
      const rolesCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(organization)
        .where(and(...whereClause))
        .execute();
      const rolesList = (await drizzle
        .select(selectFields)
        .from(organization)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof organization>[];
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
  .get(
    "/organization/cached",
    async ({ user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("organizations.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const rolesList = await cacheController.getCachedOrganization({});
      return rolesList;
    }
  )
  .get(
    "/organization/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("organizations.one")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const organizationItem = await drizzle
        .select()
        .from(organization)
        .where(eq(organization.id, id))
        .execute();
      if (!organizationItem.length) {
        set.status = 404;
        return {
          message: "Organization not found",
        };
      }
      return organizationItem[0];
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/organization",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("organizations.add")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const organizationItem = await drizzle
        .insert(organization)
        .values(data)
        .execute();

      await cacheController.cacheOrganization();
      return {
        data: organizationItem,
      };
    },
    {
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          description: t.Optional(t.Nullable(t.String())),
          phone: t.Optional(t.Nullable(t.String())),
          icon_url: t.Optional(t.Nullable(t.String())),
          code: t.Optional(t.Nullable(t.String())),
        }),
      }),
    }
  )
  .put(
    "/organization/:id",
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
      if (!user.permissions.includes("organizations.edit")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      await cacheController.cacheOrganization();
      const organizationItem = await drizzle
        .update(organization)
        .set(data)
        .where(eq(organization.id, id))
        .execute();

      return organizationItem[0];
    },

    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          name: t.Optional(t.String()),
          active: t.Optional(t.Boolean()),
          description: t.Optional(t.Nullable(t.String())),
          phone: t.Optional(t.Nullable(t.String())),
          icon_url: t.Optional(t.Nullable(t.String())),
          code: t.Optional(t.Nullable(t.String())),
        }),
      }),
    }
  )
  .delete(
    "/organization/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("organizations.delete")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const organizationItem = await drizzle
        .delete(organization)
        .where(eq(organization.id, id))
        .execute();

      await cacheController.cacheOrganization();
      return organizationItem[0];
    },

    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
