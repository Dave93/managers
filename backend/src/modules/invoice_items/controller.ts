import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  invoice_items,
  invoices,
  measure_unit,
  nomenclature_element,
  organization,
  users_stores,
} from "backend/drizzle/schema";
import dayjs from "dayjs";
import { SQLWrapper, sql, and, eq, inArray, asc, desc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { InvoiceItemsListDto } from "./dto/list.dto";

export const invoiceItemsController = new Elysia({
  name: "@api/invoice_items",
})
  .use(ctx)
  .get(
    "/invoice_items",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      drizzle,
      cacheController,
      role
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, invoice_items, {
          measure_unit,
          nomenclature_element,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      console.log("filters", filters);
      if (filters) {
        let filtersArray = JSON.parse(filters);

        whereClause = parseFilterFields(filters, invoice_items, {
          measure_unit,
          nomenclature_element,
        });
      }
      const permissions = await cacheController.getPermissionsByRoleId(
        role!.id
      );

      const hasFranchisePermission = permissions.includes(
        "franchise_manager.list"
      );

      const invoiceItems = (await drizzle
        .select(
          hasFranchisePermission
            ? {
                id: invoice_items.id,
                actualAmount: invoice_items.actualAmount,
                amount: invoice_items.amount,
                productId: invoice_items.productId,
                invoiceincomingdate: invoice_items.invoiceincomingdate,
                productName: nomenclature_element.name,
                productArticle: invoice_items.productArticle,
                unit: measure_unit.name,
                sum: invoice_items.sum,
              }
            : {
                id: invoice_items.id,
                actualAmount: invoice_items.actualAmount,
                amount: invoice_items.amount,
                productId: invoice_items.productId,
                invoiceincomingdate: invoice_items.invoiceincomingdate,
                productName: nomenclature_element.name,
                productArticle: invoice_items.productArticle,
                unit: measure_unit.name,
              }
        )
        .from(invoice_items)
        .leftJoin(
          nomenclature_element,
          eq(invoice_items.productId, nomenclature_element.id)
        )
        .leftJoin(
          measure_unit,
          eq(nomenclature_element.mainUnit, measure_unit.id)
        )
        .where(and(...whereClause))
        .orderBy(asc(nomenclature_element.name))
        .execute()) as InvoiceItemsListDto[];
      console.log("invoiceItems", invoiceItems);
      return {
        data: invoiceItems,
      };
    },
    {
      permission: "invoice_items.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  );
