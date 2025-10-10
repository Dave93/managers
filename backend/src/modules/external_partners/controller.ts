import { externalPartners } from "@backend/../drizzle/schema";
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { SQLWrapper, and, eq, sql } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-typebox";
import Elysia, { t } from "elysia";
import { getAllCachedPartners, getCachedPartner, getCachedPartnerByEmail, cachePartner, invalidatePartnerCache } from "./utils";
export const externalPartnersController = new Elysia({
  name: "@api/external_partners",
})
  .use(ctx)
  .get(
    "/external_partners",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
          selectFields = parseSelectFields(fields, externalPartners, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, externalPartners, {});
      }
      const rolesCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(externalPartners)
        .where(and(...whereClause))
        .execute();
      const rolesList = await drizzle
        .select(selectFields)
        .from(externalPartners)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return {
        total: rolesCount[0].count,
        data: rolesList,
      };
    },
    {
      permission: "external_partners.list",
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
    "/external_partners/cached",
    async ({ redis, drizzle }) => {
      // Try to get from cache first
      let partners = await getAllCachedPartners(redis);

      // If cache is empty, fetch from DB and populate cache
      if (partners.length === 0) {
        partners = await drizzle
          .select()
          .from(externalPartners)
          .where(eq(externalPartners.is_deleted, false))
          .execute();

        // Cache all partners
        await Promise.all(partners.map(partner => cachePartner(redis, partner)));
      }

      return partners;
    },
    {
      permission: "external_partners.list",
    }
  )
  .get(
    "/external_partners/:id",
    async ({ params: { id }, drizzle, redis }) => {
      // Try cache first
      let partner = await getCachedPartner(redis, id);

      // If not in cache, fetch from DB and cache it
      if (!partner) {
        const result = await drizzle
          .select()
          .from(externalPartners)
          .where(eq(externalPartners.id, id))
          .execute();

        partner = result[0];
        if (partner) {
          await cachePartner(redis, partner);
        }
      }

      return partner;
    },
    {
      permission: "external_partners.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .get(
    "/external_partners/by-email/:email",
    async ({ params: { email }, drizzle, redis }) => {
      // Try cache first
      let partner = await getCachedPartnerByEmail(redis, email);

      // If not in cache, fetch from DB and cache it
      if (!partner) {
        const result = await drizzle
          .select()
          .from(externalPartners)
          .where(eq(externalPartners.email, email))
          .execute();

        partner = result[0];
        if (partner) {
          await cachePartner(redis, partner);
        }
      }

      return partner;
    },
    {
      permission: "external_partners.one",
      params: t.Object({
        email: t.String(),
      }),
    }
  )
  .post(
    "/external_partners",
    //@ts-ignore
    async ({ body: { data, fields }, drizzle, redis }) => {

      if (data.password) {
        const hash = await Bun.password.hash(data.password);
        data.password = hash;
      }

      // Always return full record for proper caching
      const result = await drizzle
        .insert(externalPartners)
        .values(data)
        .returning();

      const newPartner = result[0];

      // Cache the new partner
      if (newPartner) {
        await cachePartner(redis, newPartner);
      }

      // If specific fields were requested, select them
      if (fields) {
        const selectFields = parseSelectFields(fields, externalPartners, {});
        const filtered = await drizzle
          .select(selectFields)
          .from(externalPartners)
          .where(eq(externalPartners.id, newPartner.id))
          .execute();

        return {
          data: filtered[0],
        };
      }

      return {
        data: newPartner,
      };
    },
    {
      permission: "external_partners.add",
      body: t.Object({
        data: createInsertSchema(externalPartners) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .put(
    "/external_partners/:id",
    async ({ params: { id }, body: { data, fields }, drizzle, redis }) => {
      // Get old partner data to invalidate old email cache
      const oldPartner = await getCachedPartner(redis, id);
      const oldEmail = oldPartner?.email;

      if (data.password) {
        const hash = await Bun.password.hash(data.password);
        data.password = hash;
      }
      // Always return full record for proper caching
      const result = await drizzle
        .update(externalPartners)
        .set(data)
        .where(eq(externalPartners.id, id))
        .returning();

      const updatedPartner = result[0];

      // Update cache with the new data
      if (updatedPartner) {
        // If email changed, invalidate old email cache
        if (oldEmail && oldEmail !== updatedPartner.email) {
          await invalidatePartnerCache(redis, id, oldEmail);
        }
        await cachePartner(redis, updatedPartner);
      }

      // If specific fields were requested, select them
      if (fields) {
        const selectFields = parseSelectFields(fields, externalPartners, {});
        const filtered = await drizzle
          .select(selectFields)
          .from(externalPartners)
          .where(eq(externalPartners.id, id))
          .execute();

        return {
          data: filtered[0],
        };
      }

      return {
        data: updatedPartner,
      };
    },
    {
      permission: "external_partners.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: createInsertSchema(externalPartners) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .delete(
    "/external_partners/:id",
    async ({ params: { id }, drizzle, redis }) => {
      // Get partner data to invalidate email cache
      const partner = await getCachedPartner(redis, id);
      const email = partner?.email || undefined;

      // Soft delete: mark as deleted
      const result = await drizzle
        .update(externalPartners)
        .set({ is_deleted: true, updatedAt: new Date() })
        .where(eq(externalPartners.id, id))
        .returning();

      // Invalidate cache (both ID and email)
      if (result[0]) {
        await invalidatePartnerCache(redis, id, email);
      }

      return {
        success: true,
        data: result[0],
      };
    },
    {
      permission: "external_partners.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
