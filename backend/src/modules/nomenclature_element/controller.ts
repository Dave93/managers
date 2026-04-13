import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { nomenclature_element } from "@backend/../drizzle/schema";
import { SQLWrapper, and, eq, sql } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const nomenclatureElementController = new Elysia({
  name: "@api/nomenclature_element",
})
  .use(ctx)
  .get(
    "/nomenclature_element",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields | undefined;
      if (fields) {
        selectFields = parseSelectFields(
          fields,
          nomenclature_element,
          {}
        );
      }
      let whereClause: (SQLWrapper | undefined)[] = [
        eq(nomenclature_element.deleted, false),
        eq(nomenclature_element.type, 'DISH'),
      ];
      if (filters) {
        whereClause.push(
          ...parseFilterFields(
            filters,
            nomenclature_element,
            {}
          )
        );
      }
      const nomenclatureElementCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(nomenclature_element)
        .where(and(...whereClause))
        .execute();
      const query = selectFields
        ? drizzle.select(selectFields)
        : drizzle.select();
      const nomenclatureElementList = await query
        .from(nomenclature_element)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: nomenclatureElementCount[0].count,
        data: nomenclatureElementList,
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
  );
