import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { nomenclature_element_organization } from "backend/drizzle/schema";
import { SQLWrapper, and, eq, sql } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const nomenclatureElementOrganizationController = new Elysia({
  name: "@api/nomenclature_element_organization",
})
  .use(ctx)
  .get(
    "/nomenclature_element_organization",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(
          fields,
          nomenclature_element_organization,
          {}
        );
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(
          filters,
          nomenclature_element_organization,
          {}
        );
      }
      const nomenclature_element_organizationCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(nomenclature_element_organization)
        .where(and(...whereClause))
        .execute();
      const nomenclature_element_organizationList = await drizzle
        .select(selectFields)
        .from(nomenclature_element_organization)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: nomenclature_element_organizationCount[0].count,
        data: nomenclature_element_organizationList,
      };
    },
    {
      permission: "nomenclature_element_organization.list",
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
    "/nomenclature_element_organization/get_for_product/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      const nomenclature_element_organizationList = await drizzle
        .select({
          id: nomenclature_element_organization.id,
          nomenclature_element_id:
            nomenclature_element_organization.nomenclature_element_id,
          organization_id: nomenclature_element_organization.organization_id,
        })
        .from(nomenclature_element_organization)
        .where(
          eq(nomenclature_element_organization.nomenclature_element_id, id)
        )
        .execute();

      return nomenclature_element_organizationList;
    },
    {
      permission: "nomenclature_element_organization.list",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/nomenclature_element_organization/set",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      await drizzle
        .delete(nomenclature_element_organization)
        .where(
          eq(
            nomenclature_element_organization.nomenclature_element_id,
            data.nomenclature_element_id
          )
        )
        .execute();
      const nomenclature_element_organizationList = await drizzle
        .insert(nomenclature_element_organization)
        .values(
          data.organization_ids.map((organization_id) => ({
            organization_id,
            nomenclature_element_id: data.nomenclature_element_id,
          }))
        )
        .returning()
        .execute();
      return {
        data: nomenclature_element_organizationList,
      };
    },
    {
      permission: "nomenclature_element_organization.add",
      body: t.Object({
        data: t.Object({
          nomenclature_element_id: t.String(),
          organization_ids: t.Array(t.String()),
        }),
      }),
    }
  );
