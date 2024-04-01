import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  internal_transfer,
  internal_transfer_items,
  measure_unit,
  nomenclature_element,
  invoice_items,
  corporation_store,
  conception,
} from "backend/drizzle/schema";
import dayjs from "dayjs";
import { SQLWrapper, sql, and, eq, inArray, asc, desc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const internalTransferItemsController = new Elysia({
  name: "@api/internal_transfer_items",
})
  .use(ctx)
  .get(
    "/internal_transfer_items",
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
      if (!user.permissions.includes("internal_transfer_items.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, internal_transfer_items, {
          internal_transfer,
          internal_transfer_items,
          measure_unit,
          nomenclature_element,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        let filtersArray = JSON.parse(filters);

        whereClause = parseFilterFields(filters, internal_transfer_items, {
          internal_transfer,
          internal_transfer_items,
          measure_unit,
          nomenclature_element,
        });
      }

      const internalTransferItems = await drizzle
        .select({
          id: internal_transfer_items.id,
          productId: internal_transfer_items.productId,
          amount: internal_transfer_items.amount,
          measureUnitId: internal_transfer_items.measureUnitId,
          containerId: internal_transfer_items.containerId,
          cost: internal_transfer_items.cost,
          internal_transfer_id: internal_transfer_items.internal_transfer_id,
          num: internal_transfer_items.num,
        })
        .from(internal_transfer_items)
        .leftJoin(
          internal_transfer,
          eq(internal_transfer_items.internal_transfer_id, internal_transfer.id)
        )
        .leftJoin(
          nomenclature_element,
          eq(internal_transfer_items.productId, nomenclature_element.id)
        )
        .where(and(...whereClause))
        .orderBy(asc(nomenclature_element.name))
        .execute();
      console.log("internalTransferItems", internalTransferItems);
      return {
        data: internalTransferItems,
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
  );