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
import { InternalTransferListDto } from "./dto/list.dto";

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

      const fromStore = alias(corporation_store, "from_store");
      const toStore = alias(corporation_store, "to_store");

      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        let filtersArray = JSON.parse(filters);

        const storeIdFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "storeFromId" || filter.field === "storeToId"
        );
        if (!storeIdFilter) {
          return {
            data: [],
          };
        }
        whereClause = parseFilterFields(filters, internal_transfer, {
          internal_transfer,
          internal_transfer_items,
          measure_unit,
          nomenclature_element,
        });

        whereClause.push(eq(internal_transfer.status, "PROCESSED"));
      }

      const internalTransferCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(internal_transfer)
        .where(and(...whereClause))
        .execute();

      const internalTransferList = (await drizzle
        .select({
          id: internal_transfer.id,
          // storeFromId: corporation_store.name,
          // storeToId: corporation_store.name,
          documentNumber: internal_transfer.documentNumber,
          dateIncoming: internal_transfer.dateIncoming,
          fromStoreName: fromStore.name,
          toStoreName: toStore.name,
        })
        .from(internal_transfer)
        .leftJoin(conception, eq(conception.id, internal_transfer.conceptionId))
        .leftJoin(fromStore, eq(fromStore.id, internal_transfer.storeFromId))
        .leftJoin(toStore, eq(toStore.id, internal_transfer.storeToId))
        .where(and(...whereClause))
        .orderBy(desc(internal_transfer.dateIncoming))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InternalTransferListDto[];
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
