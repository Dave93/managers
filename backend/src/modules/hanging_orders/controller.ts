import Elysia, { t } from "elysia";
import { credentials, hangingOrders } from "@backend/../drizzle/schema";
import {
  InferSelectModel,
  SQLWrapper,
  and,
  eq,
  getTableColumns,
  gte,
  isNull,
  notInArray,
  or,
  sql,
  desc,
  asc,
} from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { createInsertSchema } from "drizzle-typebox";
import { ctx } from "@backend/context";
import dayjs from "dayjs";


// ---------------------------------------------------------------------------
// Ре-синк статусов из iiko.
//
// Ночной бот (отдельный репозиторий iikohangingorders, root crontab 9:01/9:02)
// делает разовый снимок вчерашних незакрытых доставок, а при повторном запуске
// существующие строки пропускает, а не обновляет. Поэтому заказ, закрытый
// филиалом уже ПОСЛЕ снимка, навсегда остаётся здесь со статусом Waiting/OnWay.
//
// Этот endpoint перечитывает iiko по открытым строкам за последние `days` дней
// и обновляет order_status / problem / amount. Ручные поля status и comment не
// трогаем — их заполняют менеджеры.
// ---------------------------------------------------------------------------

const IIKO_URL = "https://api-ru.iiko.services/api/1/";

// Те же организации, что и в cron/get_orders_by_source.ts.
const BRAND_ORG_ID: Record<string, string> = {
  chopar: "664eca32-e479-4860-b1bb-56bb0cee5190",
  les_ailes: "d955355b-c4db-3798-0163-14f6b09d000d",
};

// В отличие от бота запрашиваем И финальные статусы — ровно они и нужны, чтобы
// погасить строку, которую филиал закрыл после утреннего снимка.
const ALL_DELIVERY_STATUSES = [
  "Unconfirmed",
  "WaitCooking",
  "ReadyForCooking",
  "CookingStarted",
  "CookingCompleted",
  "Waiting",
  "OnWay",
  "Delivered",
  "Closed",
  "Cancelled",
];

const FINAL_STATUSES = ["Closed", "Cancelled"];

// iiko лимитирует частоту; повторяем только на 429, как в боте.
async function fetchIikoWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let delay = 1000;
  let res = await fetch(url, init);
  for (let attempt = 1; attempt < 3 && res.status === 429; attempt++) {
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
    res = await fetch(url, init);
  }
  return res;
}

type RefreshReport = {
  brand: string;
  dates: string[];
  checked: number;
  updated: number;
  closed: number;
  errors: string[];
};

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
  )
  .post(
    "/hanging-orders/refresh",
    async ({ body: { brand, days }, drizzle }) => {
      const windowDays = days ?? 3;
      const brands = brand ? [brand] : Object.keys(BRAND_ORG_ID);
      const since = dayjs().subtract(windowDays, "day").format("YYYY-MM-DD");

      const summary: RefreshReport[] = [];

      for (const currentBrand of brands) {
        const report: RefreshReport = {
          brand: currentBrand,
          dates: [],
          checked: 0,
          updated: 0,
          closed: 0,
          errors: [],
        };
        summary.push(report);

        const orgId = BRAND_ORG_ID[currentBrand];
        if (!orgId) {
          report.errors.push(`Неизвестный бренд: ${currentBrand}`);
          continue;
        }

        const openRows = await drizzle
          .select({
            id: hangingOrders.id,
            orderId: hangingOrders.orderId,
            date: hangingOrders.date,
            orderStatus: hangingOrders.orderStatus,
          })
          .from(hangingOrders)
          .where(
            and(
              eq(hangingOrders.brand, currentBrand),
              gte(hangingOrders.date, since),
              or(
                isNull(hangingOrders.orderStatus),
                notInArray(hangingOrders.orderStatus, FINAL_STATUSES)
              )
            )
          )
          .execute();

        report.checked = openRows.length;
        if (openRows.length === 0) continue;

        const orgCreds = await drizzle
          .select({ type: credentials.type, key: credentials.key })
          .from(credentials)
          .where(
            and(
              eq(credentials.model, "organization"),
              eq(credentials.model_id, orgId)
            )
          )
          .execute();

        const apiLogin = orgCreds.find((c) => c.type === "iiko_login")?.key;
        const iikoOrgId = orgCreds.find((c) => c.type === "iiko_id")?.key;
        if (!apiLogin || !iikoOrgId) {
          report.errors.push(
            `${currentBrand}: нет iiko-кредов организации (iiko_login / iiko_id)`
          );
          continue;
        }

        let token: string | undefined;
        try {
          const tokenBody: any = await (
            await fetchIikoWithRetry(`${IIKO_URL}access_token`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ apiLogin }),
            })
          ).json();
          token = tokenBody?.token;
          if (!token) {
            report.errors.push(
              `${currentBrand}: iiko не выдал токен — ${
                tokenBody?.errorDescription ?? "нет описания"
              }`
            );
            continue;
          }
        } catch (e: any) {
          report.errors.push(
            `${currentBrand}: ошибка access_token — ${e.message}`
          );
          continue;
        }

        const dates = [...new Set(openRows.map((r) => r.date))].sort();
        report.dates = dates;

        for (const date of dates) {
          const freshById = new Map<string, any>();
          try {
            const res = await fetchIikoWithRetry(
              `${IIKO_URL}deliveries/by_delivery_date_and_status`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  organizationIds: [iikoOrgId],
                  deliveryDateFrom: `${date} 00:00:00.123`,
                  deliveryDateTo: `${date} 23:59:59.123`,
                  statuses: ALL_DELIVERY_STATUSES,
                }),
              }
            );
            if (!res.ok) {
              report.errors.push(
                `${currentBrand} ${date}: iiko ответил ${res.status} ${res.statusText}`
              );
              continue;
            }
            const payload: any = await res.json();
            for (const byOrg of payload?.ordersByOrganizations ?? []) {
              for (const order of byOrg?.orders ?? []) {
                if (order?.id) freshById.set(order.id, order);
              }
            }
          } catch (e: any) {
            report.errors.push(`${currentBrand} ${date}: ${e.message}`);
            continue;
          }

          for (const row of openRows.filter((r) => r.date === date)) {
            const fresh = row.orderId ? freshById.get(row.orderId) : undefined;
            // Заказа нет в ответе — строку не трогаем: устаревший статус лучше,
            // чем затирание по неполному ответу iiko.
            if (!fresh) continue;

            const nextStatus: string | undefined = fresh.order?.status;
            // NULL не пишем: список в админке фильтруется через NOT IN, а он
            // отбрасывает строки с NULL — заказ бы просто исчез со страницы.
            if (!nextStatus || nextStatus === row.orderStatus) continue;

            await drizzle
              .update(hangingOrders)
              .set({
                orderStatus: nextStatus,
                problem:
                  fresh.order?.problem?.description
                    ?.replace(/\n/g, " ")
                    .trim() || null,
                amount:
                  fresh.order?.sum != null ? String(fresh.order.sum) : null,
                updatedAt: new Date(),
              })
              .where(eq(hangingOrders.id, row.id))
              .execute();

            report.updated++;
            if (FINAL_STATUSES.includes(nextStatus)) {
              report.closed++;
            }
          }
        }
      }

      return { data: summary };
    },
    {
      permission: "hanging_orders.edit",
      body: t.Object({
        brand: t.Optional(
          t.Union([t.Literal("chopar"), t.Literal("les_ailes")])
        ),
        days: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      }),
    }
  );