import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  nomenclature_element,
  nomenclature_element_group,
  nomenclature_element_organization,
  organization,
  product_group_items,
  product_groups,
} from "backend/drizzle/schema";
import {
  InferSelectModel,
  SQLWrapper,
  and,
  desc,
  asc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { ProductGroupsListDto } from "./dto/productGroupsList.dto";

export const productGroupsController = new Elysia({
  name: "@api/product_groups",
})
  .use(ctx)
  .get(
    "/product_groups",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, product_groups, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, product_groups, {});
      }
      const product_groupsCount = await drizzle
        .select({ count: sql`count(*)` })
        .from(product_groups)
        .where(and(...whereClause))
        .execute();
      const product_groupsList = (await drizzle
        .select(selectFields)
        .from(product_groups)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof product_groups>[];
      return {
        total: product_groupsCount[0].count,
        data: product_groupsList,
      };
    },
    {
      permission: "product_groups.list",
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
    "/product_groups/products_with_group",
    async ({ query: { organization_id }, user, set, drizzle }) => {
      const productElements = await drizzle
        .select({
          id: nomenclature_element.id,
          name: nomenclature_element.name,
          group_id: product_group_items.product_group_id,
          organization: {
            id: nomenclature_element_organization.organization_id,
            name: organization.name,
          },
        })
        .from(nomenclature_element)
        .leftJoin(
          product_group_items,
          eq(product_group_items.product_id, nomenclature_element.id)
        )
        .leftJoin(
          nomenclature_element_organization,
          eq(
            nomenclature_element_organization.nomenclature_element_id,
            nomenclature_element.id
          )
        )
        .leftJoin(
          organization,
          eq(organization.id, nomenclature_element_organization.organization_id)
        )
        .where(
          and(
            or(
              eq(
                nomenclature_element_organization.organization_id,
                organization_id
              ),
              isNull(nomenclature_element_organization.organization_id)
            ),
            eq(nomenclature_element.deleted, false),
            inArray(nomenclature_element.type, ["PREPARED", "GOODS"])
          )
        )
        .orderBy(asc(nomenclature_element.name))
        .execute();

      const res = productElements.map((item) => ({
        ...item,
        group_id: item.group_id ?? "null",
      }));
      const aggregatedResults: ProductGroupsListDto[] = [];

      const elementMap = new Map<string, ProductGroupsListDto>();

      res.forEach((result) => {
        if (!elementMap.has(result.id)) {
          elementMap.set(result.id, {
            ...result,
            organization: [],
          });
        }

        if (result.organization.id) {
          elementMap.get(result.id)?.organization.push({
            id: result.organization.id,
            // @ts-ignore
            name: result.organization.name,
          });
        }
      });

      aggregatedResults.push(...elementMap.values());
      return aggregatedResults;
    },
    {
      permission: "product_groups.list",
      query: t.Object({
        organization_id: t.String(),
      }),
    }
  )
  .get(
    "/product_groups/cached",
    async ({ user, set, cacheController }) => {
      const product_groupsList = await cacheController.getCachedProductGroups(
        {}
      );
      return product_groupsList;
    },
    {
      permission: "product_groups.list",
    }
  )
  .get(
    "/product_groups/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      const product_groupList = await drizzle
        .select()
        .from(product_groups)
        .where(eq(product_groups.id, id))
        .execute();
      if (!product_groupList.length) {
        set.status = 404;
        return {
          message: "Product group not found",
        };
      }
      return product_groupList[0];
    },
    {
      permission: "product_groups.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/product_groups",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      let sort = 0;

      const existingProductGroups = await drizzle
        .select()
        .from(product_groups)
        .where(eq(product_groups.organization_id, data.organization_id))
        .orderBy(desc(product_groups.sort))
        .limit(1)
        .execute();

      if (existingProductGroups.length) {
        sort = existingProductGroups[0].sort + 1;
      }

      const product_groupList = await drizzle
        .insert(product_groups)
        .values({
          ...data,
          sort,
        })
        .returning()
        .execute();
      await cacheController.cacheProductGroups();
      return product_groupList;
    },
    {
      permission: "product_groups.add",
      body: t.Object({
        data: t.Object({
          name: t.String(),
          organization_id: t.String(),
        }),
      }),
    }
  )
  .post(
    "/product_groups/set_group",
    async ({ body: { data }, user, set, drizzle, cacheController }) => {
      if (data.before_group_id) {
        const product_groupList = await drizzle
          .update(product_group_items)
          .set({ product_group_id: data.group_id })
          .where(
            and(
              eq(product_group_items.product_id, data.product_id),
              eq(product_group_items.product_group_id, data.before_group_id)
            )
          )
          .returning()
          .execute();
        return product_groupList;
      } else {
        const product_groupList = await drizzle
          .insert(product_group_items)
          .values({
            product_id: data.product_id,
            product_group_id: data.group_id,
          })
          .returning()
          .execute();
        return product_groupList;
      }
    },
    {
      permission: "product_groups.set_group",
      body: t.Object({
        data: t.Object({
          before_group_id: t.Optional(t.String()),
          product_id: t.String(),
          group_id: t.String(),
        }),
      }),
    }
  )
  .put(
    "/product_groups/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      const product_groupList = await drizzle
        .update(product_groups)
        .set(data)
        .where(eq(product_groups.id, id))
        .returning()
        .execute();
      await cacheController.cacheProductGroups();
      return product_groupList;
    },
    {
      permission: "product_groups.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          name: t.Optional(t.String()),
          sort: t.Optional(t.Number()),
          show_inventory: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/product_groups/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      const product_groupList = await drizzle
        .delete(product_groups)
        .where(eq(product_groups.id, id))
        .execute();
      await cacheController.cacheProductGroups();
      return product_groupList;
    },
    {
      permission: "product_groups.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
