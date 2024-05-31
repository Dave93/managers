import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  corporation_store,
  invoice_items,
  invoices,
  measure_unit,
  nomenclature_element,
  organization,
  suppliers,
  users_stores,
  report_olap
} from "backend/drizzle/schema";
import dayjs from "dayjs";
import { SQLWrapper, sql, and, eq, inArray, asc, desc, not } from "drizzle-orm";
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
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("report_olap.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, report_olap, {
          invoices,
          measure_unit,
          nomenclature_element,
          report_olap,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      let fromDate = dayjs().subtract(40, "day");
      let toDate = dayjs();
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

        const fromDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "invoiceincomingdate" && filter.operator === "gte"
        );
        if (fromDateFilter) {
          fromDate = dayjs(fromDateFilter.value);
        }

        const toDateFilter = filtersArray.find(
          (filter: any) =>
            filter.field === "invoiceincomingdate" && filter.operator === "lte"
        );
        if (toDateFilter) {
          toDate = dayjs(toDateFilter.value);
        }

        whereClause = parseFilterFields(filters, invoice_items, {
          invoices,
        });

        whereClause.push(eq(invoices.type, "incoming"));
        whereClause.push(not(eq(invoices.status, "DELETED")));
      }

      const invoiceItems = await drizzle
        .select({
          id: invoice_items.id,
          actualAmount: invoice_items.actualAmount,
          amount: invoice_items.amount,
          productId: invoice_items.productId,
          storeId: invoice_items.storeId,
          invoiceincomingdate: invoice_items.invoiceincomingdate,
          productName: nomenclature_element.name,
          supplierProductArticle: invoice_items.supplierProductArticle,
          unit: measure_unit.name,
        })
        .from(invoice_items)
        .leftJoin(
          invoices,
          and(
            eq(invoice_items.invoice_id, invoices.id),
            eq(invoices.incomingDate, invoice_items.invoiceincomingdate)
          )
        )
        .leftJoin(measure_unit, eq(invoice_items.amountUnit, measure_unit.id))
        .leftJoin(
          nomenclature_element,
          eq(invoice_items.productId, nomenclature_element.id)
        )
        .where(and(...whereClause))
        .orderBy(asc(nomenclature_element.name))
        .execute();
      let productsByDate: Record<string, Record<string, any>> = {};
      for (let invoiceItem of invoiceItems) {
        if (!productsByDate[invoiceItem.productId!]) {
          productsByDate[invoiceItem.productId!] = {
            name: invoiceItem.productName!,
            unit: invoiceItem.unit!,
            supplierProductArticle: invoiceItem.supplierProductArticle!,
          };

          for (var m = fromDate; m.isBefore(toDate); m = m.add(1, "day")) {
            productsByDate[invoiceItem.productId!][
              m.format("YYYY_MM_DD") + "_act"
            ] = "";
            productsByDate[invoiceItem.productId!][
              m.format("YYYY_MM_DD") + "_base"
            ] = "";
          }
        }

        if (
          invoiceItem.actualAmount &&
          typeof productsByDate[invoiceItem.productId!][
            dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") +
              "_act"
          ] == "string"
        ) {
          productsByDate[invoiceItem.productId!][
            dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") +
              "_act"
          ] = 0;
        }
        if (
          invoiceItem.amount &&
          typeof productsByDate[invoiceItem.productId!][
            dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") +
              "_base"
          ] == "string"
        ) {
          productsByDate[invoiceItem.productId!][
            dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") +
              "_base"
          ] = 0;
        }
        productsByDate[invoiceItem.productId!][
          dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") + "_act"
        ] += +invoiceItem.actualAmount!;
        productsByDate[invoiceItem.productId!][
          dayjs(invoiceItem.invoiceincomingdate!).format("YYYY_MM_DD") + "_base"
        ] += +invoiceItem.amount!;
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
  )