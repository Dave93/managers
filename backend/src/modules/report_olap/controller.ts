import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  corporation_store,
  invoice_items,
  measure_unit,
  nomenclature_element,
  report_olap,
} from "@backend/../drizzle/schema";
import dayjs from "dayjs";
import {
  SQLWrapper,
  sql,
  and,
  eq,
  inArray,
  asc,
  desc,
  not,
  lte,
  gte,
} from "drizzle-orm";
import { SelectedFields, doublePrecision } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";

export const reportOlapController = new Elysia({
  name: "@api/report_olap",
})
  .use(ctx)
  .get(
    "/report_olap",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, report_olap, {
          measure_unit,
          nomenclature_element,
          corporation_store,
          invoice_items,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      let fromDate = dayjs().subtract(40, "day");
      let toDate = dayjs();
      if (filters) {
        let filtersArray = JSON.parse(filters);

        console.log("filtersArray", filtersArray);

        const storeIdFilter = filtersArray.find(
          (filter: any) => filter.field === "corporation_store.id"
        );
        if (!storeIdFilter) {
          return {
            data: [],
          };
        }

        const fromDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "dateTime" && filter.operator === "gte"
        );
        if (fromDateFilter) {
          fromDate = dayjs(fromDateFilter.value);
        }

        const toDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "dateTime" && filter.operator === "lte"
        );
        if (toDateFilter) {
          toDate = dayjs(toDateFilter.value);
        }

        whereClause = parseFilterFields(filters, report_olap, {
          invoice_items,
          measure_unit,
          nomenclature_element,
          corporation_store,
        });

        whereClause.push(gte(report_olap.dateTime, fromDate.toISOString()));
        whereClause.push(lte(report_olap.dateTime, toDate.toISOString()));
      }
      const repOlapItems = await drizzle
        .select({
          id: report_olap.id,
          dateTime: report_olap.dateTime,
          productId: report_olap.productId,
          productName: report_olap.productName,
          unit: report_olap.productUnit,
          actualAmount: report_olap.amauntOut,
          supplierProductArticle: report_olap.productNum,
        })
        .from(report_olap)
        .leftJoin(
          corporation_store,
          eq(corporation_store.name, report_olap.store)
        )
        .where(and(...whereClause))
        .orderBy(asc(report_olap.productName))
        .execute();
      let productsByDate: Record<string, Record<string, any>> = {};

      // console.log("repOlapItems", repOlapItems);
      for (let repOlapItem of repOlapItems) {
        if (!productsByDate[repOlapItem.productId!]) {
          productsByDate[repOlapItem.productId!] = {
            name: repOlapItem.productName!,
            unit: repOlapItem.unit!,
            supplierProductArticle: repOlapItem.supplierProductArticle!,
          };

          for (var m = fromDate; m.isBefore(toDate); m = m.add(1, "day")) {
            productsByDate[repOlapItem.productId!][
              m.format("YYYY_MM_DD") + "_act"
            ] = "";
          }
        }

        if (
          repOlapItem.actualAmount &&
          typeof productsByDate[repOlapItem.productId!][
            dayjs(repOlapItem.dateTime!).format("YYYY_MM_DD") + "_act"
          ] == "string" &&
          !productsByDate[repOlapItem.productId!][
            dayjs(repOlapItem.dateTime!).format("YYYY_MM_DD")
          ]
        ) {
          productsByDate[repOlapItem.productId!][
            dayjs(repOlapItem.dateTime!).format("YYYY_MM_DD") + "_act"
          ] = 0;
        }
        if (repOlapItem.actualAmount) {
          productsByDate[repOlapItem.productId!][
            dayjs(repOlapItem.dateTime!).format("YYYY_MM_DD") + "_act"
          ] += +repOlapItem.actualAmount!;
        }
      }

      return {
        data: Object.values(productsByDate),
      };
    },
    {
      permission: "report_olap.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  );
