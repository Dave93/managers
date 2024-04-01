import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  writeoff,
  writeoff_items,
  measure_unit,
  nomenclature_element,
  invoice_items,
  internal_transfer,
  internal_transfer_items,
  corporation_store,
  conception,
} from "@backend/../drizzle/schema";
import dayjs from "dayjs";
import { SQLWrapper, sql, and, eq, inArray, asc, desc } from "drizzle-orm";
import { SelectedFields, alias } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { drizzle } from "drizzle-orm/postgres-js";

export const internalTransferOffController = new Elysia({
  name: "@api/internal_transfer",
})

  .use(ctx)
  .get(
    "/internal_transfer",
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
      if (!user.permissions.includes("internal_transfer.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, internal_transfer, {
          internal_transfer,
          internal_transfer_items,
          measure_unit,
          nomenclature_element,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];

      if (filters) {
        let filtersArray = JSON.parse(filters);

        console.log("filtersArray", filtersArray);

        const storeIdFilter = filtersArray.find(
          (filter: any) => filter.field === "storeId"
        );
        if (!storeIdFilter) {
          return {
            data: [],
          };
        }
      }

      const internalTransferCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(internal_transfer)

        .where(and(...whereClause))
        .execute();

      const fromStore = alias(corporation_store, "from_store");
      const toStore = alias(corporation_store, "to_store");

      const internalTransferList = await drizzle
        .select({
          id: internal_transfer.id,
          // storeFromId: corporation_store.name,
          // storeToId: corporation_store.name,
          dateIncoming: internal_transfer.dateIncoming,
          productName: nomenclature_element.name,
          amount: internal_transfer_items.amount,
          fromStoreName: fromStore.name,
          toStoreName: toStore.name,
        })
        .from(internal_transfer)
        .leftJoin(conception, eq(conception.id, internal_transfer.conceptionId))
        .leftJoin(fromStore, eq(fromStore.id, internal_transfer.storeFromId))
        .leftJoin(toStore, eq(toStore.id, internal_transfer.storeToId))
        .leftJoin(
          internal_transfer_items,
          eq(internal_transfer_items.internal_transfer_id, internal_transfer.id)
        )
        .leftJoin(
          nomenclature_element,
          eq(nomenclature_element.id, internal_transfer_items.productId)
        )
        .where(and(...whereClause))
        .orderBy(desc(internal_transfer.dateIncoming))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return {
        total: internalTransferCount[0].count,
        data: internalTransferList,
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
