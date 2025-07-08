import Elysia, { t } from "elysia";
import { hangingOrders } from "@backend/../drizzle/schema";
import {
  InferSelectModel,
  SQLWrapper,
  and,
  eq,
  getTableColumns,
  sql,
  desc,
  asc,
} from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { createInsertSchema } from "drizzle-typebox";
import { ctx } from "@backend/context";


export const hangingOrdersController = new Elysia({
  name: "@api/hanging-orders",
})
  .use(ctx)
  .get(
    "/hanging-orders",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      } else {
        selectFields = getTableColumns(hangingOrders);
      }

      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        try {
          whereClause = parseFilterFields(filters, hangingOrders, {});
        } catch (error) {
          console.error('Error parsing filters:', error);
          throw error;
        }
      }

      const ordersCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(hangingOrders)
        .where(and(...whereClause))
        .execute();

      let orderByClause = desc(hangingOrders.createdAt); // default ordering
      if (sort) {
        const [field, direction] = sort.split(':');
        const column = hangingOrders[field as keyof typeof hangingOrders];
        if (column && typeof column === 'object' && 'name' in column) {
          orderByClause = direction === 'desc' ? desc(column as any) : asc(column as any);
        }
      }

      const ordersList = await drizzle
        .select(selectFields)
        .from(hangingOrders)
        .where(and(...whereClause))
        .orderBy(orderByClause)
        .limit(+limit)
        .offset(+offset)
        .execute();

      return {
        total: ordersCount[0].count,
        data: ordersList,
      };
    },
    {
      permission: "hanging_orders.list",
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
    "/hanging-orders/:id",
    async ({
      params: { id },
      user,
      set,
      drizzle,
    }) => {
      const order = await drizzle
        .select()
        .from(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .execute();

      if (!order[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: order[0],
      };
    },
    {
      permission: "hanging_orders.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/hanging-orders",
    async ({ body: { data, fields }, user, set, drizzle }) => {
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      } else {
        selectFields = {
          id: hangingOrders.id,
        };
      }

      const result = await drizzle
        .insert(hangingOrders)
        .values(data)
        .returning(selectFields);

      return result[0];
    },
    {
      permission: "hanging_orders.add",
      body: t.Object({
        data: createInsertSchema(hangingOrders) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .put(
    "/hanging-orders/:id",
    async ({
      params: { id },
      body: { data, fields },
      user,
      set,
      drizzle,
    }) => {
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, hangingOrders, {});
      }

      data.updatedAt = new Date();

      const result = await drizzle
        .update(hangingOrders)
        .set(data)
        .where(eq(hangingOrders.id, id))
        .returning(selectFields);

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: createInsertSchema(hangingOrders) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .delete(
    "/hanging-orders/:id",
    async ({
      params: { id },
      user,
      set,
      drizzle,
    }) => {
      const result = await drizzle
        .delete(hangingOrders)
        .where(eq(hangingOrders.id, id))
        .returning({ id: hangingOrders.id });

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        message: "Order deleted successfully",
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .patch(
    "/hanging-orders/:id/status",
    async ({
      params: { id },
      body: { status, comment },
      user,
      set,
      drizzle,
    }) => {
      const result = await drizzle
        .update(hangingOrders)
        .set({
          status,
          comment,
          updatedAt: new Date(),
        })
        .where(eq(hangingOrders.id, id))
        .returning();

      if (!result[0]) {
        set.status = 404;
        return {
          message: "Order not found",
        };
      }

      return {
        data: result[0],
      };
    },
    {
      permission: "hanging_orders.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        status: t.Optional(t.String()),
        comment: t.Optional(t.String()),
      }),
    }
  );