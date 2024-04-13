import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  writeoff,
  writeoff_items,
  measure_unit,
  nomenclature_element,
  invoice_items,
} from "@backend/../drizzle/schema";
import dayjs from "dayjs";
import { SQLWrapper, sql, and, eq, inArray, asc, desc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { drizzle } from "drizzle-orm/postgres-js";

export const writeItemsOffController = new Elysia({
  name: "@api/writeoff_items",
})

  .use(ctx)
  .get(
    "/writeoff_items",
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
      if (!user.permissions.includes("writeoff_items.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, writeoff_items, {
          writeoff,
        });
      }

      let whereClause: (SQLWrapper | undefined)[] = [];
      let fromDate = dayjs().subtract(40, "day");
      let toDate = dayjs();
      if (filters) {
        let filtersArray = JSON.parse(filters);

        // console.log("filtersArray", filtersArray);

        const storeIdFilter = filtersArray.find(
          (filter: any) => filter.field === "writeoff.storeId"
        );
        if (!storeIdFilter) {
          return {
            data: [],
          };
        }

        const fromDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "writeoffincomingdate" && filter.operator === "gte"
        );
        if (fromDateFilter) {
          fromDate = dayjs(fromDateFilter.value);
        }

        const toDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "writeoffincomingdate" && filter.operator === "lte"
        );

        if (toDateFilter) {
          toDate = dayjs(toDateFilter.value);
        }

        whereClause = parseFilterFields(filters, writeoff_items, {
          writeoff,
          nomenclature_element,
        });
      }
      const writeoffItems = await drizzle
        .select({
          id: writeoff_items.id,
          productId: writeoff_items.productId,
          writeoffincomingdate: writeoff_items.writeoffincomingdate,
          amount: writeoff_items.amount,
          amountFactor: writeoff_items.amountFactor,
          productName: nomenclature_element.name,
          unit: measure_unit.name,
          supplierProductArticle: nomenclature_element.num,
        })
        .from(writeoff_items)
        .leftJoin(
          writeoff,
          and(
            eq(writeoff_items.writeoff_id, writeoff.id),
            eq(writeoff.dateIncoming, writeoff_items.writeoffincomingdate)
          )
        )
        .leftJoin(
          measure_unit,
          eq(writeoff_items.measureUnitId, measure_unit.id)
        )
        .leftJoin(
          nomenclature_element,
          eq(writeoff_items.productId, nomenclature_element.id)
        )

        .where(and(...whereClause))
        .orderBy(asc(nomenclature_element.name))
        .execute();
      let productsByDate: Record<string, Record<string, any>> = {};
      for (let writeoffItem of writeoffItems) {
        if (!productsByDate[writeoffItem.productId!]) {
          productsByDate[writeoffItem.productId!] = {
            name: writeoffItem.productName!,
            unit: writeoffItem.unit!,
            supplierProductArticle: writeoffItem.supplierProductArticle!,
          };

          for (var m = fromDate; m.isBefore(toDate); m = m.add(1, "day")) {
            productsByDate[writeoffItem.productId!][m.format("YYYY_MM_DD")] =
              "";
            // productsByDate[writeoffItem.productId!][m.format("YYYY_MM_DD")] =
            //   "";
          }
        }

        if (
          writeoffItem.amount &&
          typeof productsByDate[writeoffItem.productId!][
            dayjs(writeoffItem.writeoffincomingdate!).format("YYYY_MM_DD")
          ] == "string" &&
          !productsByDate[writeoffItem.productId!][
            dayjs(writeoffItem.writeoffincomingdate!).format("YYYY_MM_DD")
          ]
        ) {
          productsByDate[writeoffItem.productId!][
            dayjs(writeoffItem.writeoffincomingdate!).format("YYYY_MM_DD")
          ] = 0;
        }
        if (writeoffItem.amount) {
          productsByDate[writeoffItem.productId!][
            dayjs(writeoffItem.writeoffincomingdate!).format("YYYY_MM_DD")
          ] += +writeoffItem.amount!;
        }
      }

      return {
        data: Object.values(productsByDate),
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
