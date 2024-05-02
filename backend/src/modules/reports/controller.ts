import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  report_status,
  reports,
  reports_items,
  reports_status,
  terminals,
  users_terminals,
  users,
} from "@backend/../drizzle/schema";
import { sql, and, SQLWrapper, eq, inArray, desc } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { ReportsWithRelations } from "./dto/list.dto";
import dayjs from "dayjs";
import { merchantApiClient } from "@backend/lib/eden";

export const reportsController = new Elysia({
  name: "@api/reports",
})
  .use(ctx)
  .get(
    "/reports",
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
      if (!user.permissions.includes("reports.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, reports, {
          terminals,
          reports_status,
          users,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, reports, {
          terminals,
          reports_status,
          users,
        });
      }
      const reportsCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(reports)
        .where(and(...whereClause))
        .execute();
      const reportsList = (await drizzle
        .select(selectFields)
        .from(reports)
        .where(and(...whereClause))
        .leftJoin(terminals, eq(reports.terminal_id, terminals.id))
        .leftJoin(reports_status, eq(reports.status_id, reports_status.id))
        .leftJoin(users, eq(reports.user_id, users.id))
        .limit(+limit)
        .offset(+offset)
        .orderBy(desc(reports.date))
        .execute()) as ReportsWithRelations[];
      return {
        total: reportsCount[0].count,
        data: reportsList,
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
  .get(
    "/reports/my_reports",
    async ({
      query: { sort, filters, fields, terminal_id },
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
      if (!user.permissions.includes("reports.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      const userTerminals = await drizzle
        .select()
        .from(users_terminals)
        .where(
          and(
            eq(users_terminals.user_id, user.user.id),
            eq(users_terminals.terminal_id, terminal_id)
          )
        )
        .execute();

      if (userTerminals.length === 0) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, reports, {
          reports_status,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [
        eq(reports.terminal_id, terminal_id),
      ];
      if (filters) {
        whereClause = parseFilterFields(filters, reports, {
          reports_status,
        });
      }
      const reportsList = (await drizzle
        .select(selectFields)
        .from(reports)
        .leftJoin(reports_status, eq(reports.status_id, reports_status.id))
        .where(and(...whereClause))
        .execute()) as ReportsWithRelations[];
      return reportsList;
    },
    {
      query: t.Object({
        terminal_id: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/reports/:id",
    async ({ params: { id }, user, set, drizzle }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports.one")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const report = await drizzle
        .select()
        .from(reports)
        .where(eq(reports.id, id))
        .execute();
      return report[0];
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .post(
    "/reports/by_date",
    async ({
      body: { date, terminal_id, time },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports.list")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      const userTerminals = await drizzle
        .select({
          user_id: users_terminals.user_id,
          terminal_id: users_terminals.terminal_id,
          terminal_name: terminals.name,
          organization_id: terminals.organization_id,
        })
        .from(users_terminals)
        .leftJoin(terminals, eq(users_terminals.terminal_id, terminals.id))
        .where(
          and(
            eq(users_terminals.user_id, user.user.id),
            eq(users_terminals.terminal_id, terminal_id)
          )
        )
        .execute();

      if (userTerminals.length === 0) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      const chosenTerminal = userTerminals[0];

      const result: {
        terminal_name: string;
        terminal_id: string;
        totalCashier: number;
        editable: boolean;
        incomes: {
          amount: number | null;
          error: string | null;
          type: string;
          readonly: boolean;
          label: string;
        }[];
        expenses: {
          amount: number | null;
          error: string | null;
          readonly: boolean;
          type: string;
          label: string;
        }[];
      } = {
        terminal_name: chosenTerminal.terminal_name!,
        terminal_id: chosenTerminal.terminal_id,
        incomes: [],
        expenses: [],
        totalCashier: 0,
        editable: true,
      };

      const reportsList = await drizzle
        .select()
        .from(reports)
        .where(
          and(
            eq(
              reports.date,
              dayjs.unix(+date).hour(0).minute(0).second(0).toISOString()
            ),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();

      const reportStatuses = await cacheController.getCachedReportStatuses({});

      const editableStatusIds = reportStatuses
        .filter(
          (status) => status.code === "sent" || status.code === "cancelled"
        )
        .map((status) => status.id);
      const allCredentials = await cacheController.getCachedCredentials({});
      const credentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal_id &&
          credential.model === "terminals"
      );

      const clickServiceIds = credentials.find(
        (c) => c.type === "click_service_ids"
      )?.key;

      if (!clickServiceIds) {
        set.status = 400;
        return {
          message: "Click service ids not found",
        };
      }

      const paymeBusinessId = credentials.find(
        (c) => c.type === "payme_business_id"
      )?.key;

      if (!paymeBusinessId) {
        set.status = 400;
        return {
          message: "Payme business id not found",
        };
      }

      const paymeMerchantIds = credentials.find(
        (c) => c.type === "payme_merchant_ids"
      )?.key;

      if (!paymeMerchantIds) {
        set.status = 400;
        return {
          message: "Payme merchant ids not found",
        };
      }

      const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

      if (!iikoId) {
        set.status = 400;
        return {
          message: "Iiko id not found",
        };
      }

      const yandexRestaurantIds = credentials.find(
        (c) => c.type === "yandex_restaurant_id"
      )?.key;

      if (!yandexRestaurantIds) {
        set.status = 400;
        return {
          message: "Yandex restaurant id not found",
        };
      }

      const organizations = await cacheController.getCachedOrganization({});
      const organization = organizations.find(
        (org) => org.id === chosenTerminal.organization_id
      );

      if (!date) {
        date = dayjs().toISOString();
      }

      date = dayjs.unix(+date).toISOString();

      if (reportsList.length == 0) {
        const [
          clickReportResult,
          paymeReportResult,
          iikoCachierReport,
          yandexReportResult,
          expressReportResult,
          arrytReportResult,
        ] = await Promise.allSettled([
          // @ts-ignore
          merchantApiClient.api.click.post({
            date,
            serviceIds: clickServiceIds.split(","),
            time,
          }),
          // @ts-ignore
          merchantApiClient.api.payme.post({
            date,
            businessId: paymeBusinessId,
            serviceIds: paymeMerchantIds.split(","),
            time,
          }),
          // @ts-ignore
          merchantApiClient.api.iiko.post({
            date,
            terminal_id: iikoId,
          }),
          // @ts-ignore
          merchantApiClient.api.yandex.post({
            date,
            organization_code: organization!.code!,
            serviceIds: yandexRestaurantIds.split(","),
            time,
          }),
          // @ts-ignore
          merchantApiClient.api.express.post({
            date,
            terminal_id,
            time,
            organization_code: organization!.code!,
          }),
          // @ts-ignore
          merchantApiClient.api.arryt.post({
            date,
            terminal_id,
            time,
          }),
        ]);

        result.incomes.push({
          amount: 0,
          error: null,
          type: "cash",
          readonly: false,
          label: "Наличными",
        });

        result.incomes.push({
          amount: 0,
          error: null,
          type: "uzcard",
          readonly: false,
          label: "Терминал",
        });

        result.incomes.push({
          amount: 0,
          error: null,
          type: "humo",
          readonly: false,
          label: "Humo",
        });

        if (clickReportResult.status == "rejected") {
          result.incomes.push({
            amount: null,
            error: clickReportResult.reason,
            type: "click",
            readonly: true,
            label: "Click",
          });
        } else {
          result.incomes.push({
            error: null,
            amount:
              clickReportResult.value.data &&
              typeof clickReportResult.value.data == "number"
                ? clickReportResult.value.data
                : 0,
            type: "click",
            readonly: true,
            label: "Click",
          });
        }

        if (paymeReportResult.status == "rejected") {
          result.incomes.push({
            error: paymeReportResult.reason,
            amount: null,
            type: "payme",
            readonly: true,
            label: "Payme",
          });
        } else {
          result.incomes.push({
            error: null,
            amount:
              paymeReportResult.value.data &&
              typeof paymeReportResult.value.data == "number"
                ? paymeReportResult.value.data
                : 0,
            type: "payme",
            readonly: true,
            label: "Payme",
          });
        }
        if (yandexReportResult.status == "rejected") {
          result.incomes.push({
            error: yandexReportResult.reason,
            amount: null,
            type: "yandex",
            readonly: true,
            label: "Yandex",
          });
        } else {
          result.incomes.push({
            error: null,
            amount:
              yandexReportResult.value.data &&
              typeof yandexReportResult.value.data == "number"
                ? yandexReportResult.value.data
                : 0,
            type: "yandex",
            readonly: true,
            label: "Yandex",
          });
        }
        if (expressReportResult.status == "rejected") {
          result.incomes.push({
            error: expressReportResult.reason,
            amount: null,
            type: "express24",
            readonly: true,
            label: "Express24",
          });
          result.incomes.push({
            error: expressReportResult.reason,
            amount: null,
            type: "myuzcard",
            readonly: true,
            label: "Myuzcard",
          });
        } else {
          let expressData = expressReportResult.value.data;
          console.log("expressData", expressData);
          if (expressData && "express" in expressData) {
            result.incomes.push({
              error: null,
              amount: expressData.express,
              type: "express24",
              readonly: true,
              label: "Express24",
            });
            result.incomes.push({
              error: null,
              amount: expressData.card,
              type: "myuzcard",
              readonly: true,
              label: "Myuzcard",
            });
          } else {
            result.incomes.push({
              error: null,
              amount: 0,
              type: "myuzcard",
              readonly: true,
              label: "Myuzcard",
            });
            result.incomes.push({
              error: null,
              amount: 0,
              type: "express24",
              readonly: true,
              label: "Express24",
            });
          }
        }

        result.incomes.push({
          amount: 0,
          error: null,
          type: "uzum_tezkor",
          readonly: false,
          label: "Uzum Tezkor",
        });

        if (arrytReportResult.status == "rejected") {
        } else {
          if (
            arrytReportResult.value.data &&
            "customerPrice" in arrytReportResult.value.data &&
            arrytReportResult.value.data.customerPrice > 0
          ) {
            result.incomes.push({
              error: null,
              amount: arrytReportResult.value.data.customerPrice,
              type: "yandex_delivery",
              readonly: true,
              label: "Yandex Sarvar",
            });
          }

          if (
            arrytReportResult.value.data &&
            "withdraws" in arrytReportResult.value.data
          ) {
            arrytReportResult.value.data.withdraws.forEach((item: any) => {
              result.expenses.push({
                error: null,
                readonly: true,
                amount: item.amount,
                type: "arryt",
                label: item.name,
              });
            });
          }
        }
        if (
          iikoCachierReport.status == "fulfilled" &&
          iikoCachierReport.value.data &&
          "totalSum" in iikoCachierReport.value.data
        ) {
          result.totalCashier = iikoCachierReport.value.data.totalSum;
        }

        return result;
      } else {
        const reportItem = reportsList[0];
        if (editableStatusIds.includes(reportItem.status_id)) {
          const existingReportItems = await drizzle
            .select()
            .from(reports_items)
            .where(
              and(
                inArray(reports_items.source, [
                  "cash",
                  "uzcard",
                  "humo",
                  "uzum_tezkor",
                  "other_expenses",
                ]),
                eq(reports_items.report_id, reportItem.id)
              )
            )
            .execute();

          const [
            clickReportResult,
            paymeReportResult,
            iikoCachierReport,
            yandexReportResult,
            expressReportResult,
            arrytReportResult,
          ] = await Promise.allSettled([
            // @ts-ignore
            merchantApiClient.api.click.post({
              date,
              serviceIds: clickServiceIds.split(","),
              time,
            }),
            // @ts-ignore
            merchantApiClient.api.payme.post({
              date,
              businessId: paymeBusinessId,
              serviceIds: paymeMerchantIds.split(","),
              time,
            }),
            // @ts-ignore
            merchantApiClient.api.iiko.post({
              date,
              terminal_id: iikoId,
            }),
            // @ts-ignore
            merchantApiClient.api.yandex.post({
              date,
              organization_code: organization!.code!,
              serviceIds: yandexRestaurantIds.split(","),
              time,
            }),
            // @ts-ignore
            merchantApiClient.api.express.post({
              date,
              terminal_id,
              time,
              organization_code: organization!.code!,
            }),
            // @ts-ignore
            merchantApiClient.api.arryt.post({
              date,
              terminal_id,
              time,
            }),
          ]);

          const cashReportItem = existingReportItems.find(
            (item) => item.source === "cash"
          );

          const uzcardReportItem = existingReportItems.find(
            (item) => item.source === "uzcard"
          );

          const humoReportItem = existingReportItems.find(
            (item) => item.source === "humo"
          );

          const uzumTezkorReportItem = existingReportItems.find(
            (item) => item.source === "uzum_tezkor"
          );

          const otherExpensesReportItems = existingReportItems.filter(
            (item) => item.source === "other_expenses"
          );

          result.incomes.push({
            // @ts-ignore
            amount: cashReportItem?.amount ?? 0,
            error: null,
            type: "cash",
            readonly: false,
            label: "Наличными",
          });

          result.incomes.push({
            // @ts-ignore
            amount: uzcardReportItem?.amount ?? 0,
            error: null,
            type: "uzcard",
            readonly: false,
            label: "Терминал",
          });

          result.incomes.push({
            // @ts-ignore
            amount: humoReportItem?.amount ?? 0,
            error: null,
            type: "humo",
            readonly: false,
            label: "Humo",
          });

          result.incomes.push({
            // @ts-ignore
            amount: uzumTezkorReportItem?.amount ?? 0,
            error: null,
            type: "uzum_tezkor",
            readonly: false,
            label: "Uzum Tezkor",
          });

          for (const item of otherExpensesReportItems) {
            result.expenses.push({
              error: null,
              // @ts-ignore
              amount: item.amount,
              readonly: false,
              type: "other_expenses",
              label: item.label,
            });
          }

          if (clickReportResult.status == "rejected") {
            result.incomes.push({
              amount: null,
              error: clickReportResult.reason,
              type: "click",
              readonly: true,
              label: "Click",
            });
          } else {
            result.incomes.push({
              error: null,
              amount:
                clickReportResult.value.data &&
                typeof clickReportResult.value.data == "number"
                  ? clickReportResult.value.data
                  : 0,
              type: "click",
              readonly: true,
              label: "Click",
            });
          }

          if (paymeReportResult.status == "rejected") {
            result.incomes.push({
              error: paymeReportResult.reason,
              amount: null,
              type: "payme",
              readonly: true,
              label: "Payme",
            });
          } else {
            result.incomes.push({
              error: null,
              amount:
                paymeReportResult.value.data &&
                typeof paymeReportResult.value.data == "number"
                  ? paymeReportResult.value.data
                  : 0,
              type: "payme",
              readonly: true,
              label: "Payme",
            });
          }
          if (yandexReportResult.status == "rejected") {
            result.incomes.push({
              error: yandexReportResult.reason,
              amount: null,
              type: "yandex",
              readonly: true,
              label: "Yandex",
            });
          } else {
            result.incomes.push({
              error: null,
              amount:
                yandexReportResult.value.data &&
                typeof yandexReportResult.value.data == "number"
                  ? yandexReportResult.value.data
                  : 0,
              type: "yandex",
              readonly: true,
              label: "Yandex",
            });
          }
          if (expressReportResult.status == "rejected") {
            result.incomes.push({
              error: expressReportResult.reason,
              amount: null,
              type: "express24",
              readonly: true,
              label: "Express24",
            });
            result.incomes.push({
              error: expressReportResult.reason,
              amount: null,
              type: "myuzcard",
              readonly: true,
              label: "Myuzcard",
            });
          } else {
            let expressData = expressReportResult.value.data;
            console.log("expressData", expressData);
            if (expressData && "express" in expressData) {
              result.incomes.push({
                error: null,
                amount: expressData.express,
                type: "express24",
                readonly: true,
                label: "Express24",
              });
              result.incomes.push({
                error: null,
                amount: expressData.card,
                type: "myuzcard",
                readonly: true,
                label: "Myuzcard",
              });
            } else {
              result.incomes.push({
                error: null,
                amount: 0,
                type: "myuzcard",
                readonly: true,
                label: "Myuzcard",
              });
              result.incomes.push({
                error: null,
                amount: 0,
                type: "express24",
                readonly: true,
                label: "Express24",
              });
            }
          }

          if (arrytReportResult.status == "rejected") {
          } else {
            if (
              arrytReportResult.value.data &&
              "customerPrice" in arrytReportResult.value.data &&
              arrytReportResult.value.data.customerPrice > 0
            ) {
              result.incomes.push({
                error: null,
                amount: arrytReportResult.value.data.customerPrice,
                type: "yandex_delivery",
                readonly: true,
                label: "Yandex Sarvar",
              });
            }

            if (
              arrytReportResult.value.data &&
              "withdraws" in arrytReportResult.value.data
            ) {
              arrytReportResult.value.data.withdraws.forEach((item: any) => {
                result.expenses.push({
                  error: null,
                  amount: item.amount,
                  readonly: true,
                  type: "arryt",
                  label: item.name,
                });
              });
            }
          }
          if (
            iikoCachierReport.status == "fulfilled" &&
            iikoCachierReport.value.data &&
            "totalSum" in iikoCachierReport.value.data
          ) {
            result.totalCashier = iikoCachierReport.value.data.totalSum;
          }
          return result;
        } else {
          result.editable = false;
          result.totalCashier = reportItem.total_amount;

          const reportItems = await drizzle
            .select()
            .from(reports_items)
            .where(eq(reports_items.report_id, reportItem.id))
            .execute();

          for (const item of reportItems) {
            if (item.type === "income") {
              result.incomes.push({
                // @ts-ignore
                amount: item.amount,
                error: null,
                type: item.source,
                readonly: true,
                label: item.label,
              });
            } else {
              result.expenses.push({
                // @ts-ignore
                amount: item.amount,
                readonly: true,
                error: null,
                type: item.source,
                label: item.label,
              });
            }
          }

          return result;
        }
      }
    },
    {
      body: t.Object({
        date: t.Union([t.String(), t.Number()]),
        terminal_id: t.String(),
        time: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .post(
    "/reports",
    async ({
      body: { terminal_id, date, incomes, expenses },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports.add")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const userTerminals = await drizzle
        .select({
          user_id: users_terminals.user_id,
          terminal_id: users_terminals.terminal_id,
          terminal_name: terminals.name,
          organization_id: terminals.organization_id,
        })
        .from(users_terminals)
        .leftJoin(terminals, eq(users_terminals.terminal_id, terminals.id))
        .where(
          and(
            eq(users_terminals.user_id, user.user.id),
            eq(users_terminals.terminal_id, terminal_id)
          )
        )
        .execute();

      if (userTerminals.length === 0) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }

      const chosenTerminal = userTerminals[0];

      const result: {
        terminal_name: string;
        terminal_id: string;
        totalCashier: number;
        editable: boolean;
        incomes: {
          amount: number | null;
          error: string | null;
          type: string;
          readonly: boolean;
          label: string;
        }[];
        expenses: {
          amount: number | null;
          error: string | null;
          type: string;
          label: string;
        }[];
      } = {
        terminal_name: chosenTerminal.terminal_name!,
        terminal_id: chosenTerminal.terminal_id,
        incomes: [],
        expenses: [],
        totalCashier: 0,
        editable: true,
      };

      const reportsList = await drizzle
        .select()
        .from(reports)
        .where(
          and(
            eq(
              reports.date,
              dayjs.unix(+date).hour(0).minute(0).second(0).toISOString()
            ),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();

      const reportStatuses = await cacheController.getCachedReportStatuses({});

      const editableStatusIds = reportStatuses
        .filter(
          (status) => status.code === "sent" || status.code === "cancelled"
        )
        .map((status) => status.id);
      const allCredentials = await cacheController.getCachedCredentials({});
      const credentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal_id &&
          credential.model === "terminals"
      );

      const clickServiceIds = credentials.find(
        (c) => c.type === "click_service_ids"
      )?.key;

      if (!clickServiceIds) {
        set.status = 400;
        return {
          message: "Click service ids not found",
        };
      }

      const paymeBusinessId = credentials.find(
        (c) => c.type === "payme_business_id"
      )?.key;

      if (!paymeBusinessId) {
        set.status = 400;
        return {
          message: "Payme business id not found",
        };
      }

      const paymeMerchantIds = credentials.find(
        (c) => c.type === "payme_merchant_ids"
      )?.key;

      if (!paymeMerchantIds) {
        set.status = 400;
        return {
          message: "Payme merchant ids not found",
        };
      }

      const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

      if (!iikoId) {
        set.status = 400;
        return {
          message: "Iiko id not found",
        };
      }

      const yandexRestaurantIds = credentials.find(
        (c) => c.type === "yandex_restaurant_id"
      )?.key;

      if (!yandexRestaurantIds) {
        set.status = 400;
        return {
          message: "Yandex restaurant id not found",
        };
      }

      const organizations = await cacheController.getCachedOrganization({});
      const organization = organizations.find(
        (org) => org.id === chosenTerminal.organization_id
      );

      const reportGroups = await cacheController.getCachedReportGroups({});

      const sentReportStatus = reportStatuses.find(
        (status) => status.code === "sent"
      );

      if (reportsList.length > 0) {
        const report = reportsList[0];
        const reportStatus = reportStatuses.find(
          (status) => status.id == report?.status_id
        );

        if (
          reportStatus &&
          ["checking", "confirmed"].includes(reportStatus.code)
        ) {
          set.status = 400;
          return {
            message: "Обновление отчёта в текущем статусе невозможно",
          };
        }
      }

      if (!date) {
        date = dayjs().toISOString();
      }

      date = dayjs.unix(+date).toISOString();

      const [
        clickReportResult,
        paymeReportResult,
        iikoCachierReport,
        yandexReportResult,
        expressReportResult,
        arrytReportResult,
      ] = await Promise.allSettled([
        // @ts-ignore
        merchantApiClient.api.click.post({
          date,
          serviceIds: clickServiceIds.split(","),
        }),
        // @ts-ignore
        merchantApiClient.api.payme.post({
          date,
          businessId: paymeBusinessId,
          serviceIds: paymeMerchantIds.split(","),
        }),
        // @ts-ignore
        merchantApiClient.api.iiko.post({
          date,
          terminal_id: iikoId,
        }),
        // @ts-ignore
        merchantApiClient.api.yandex.post({
          date,
          organization_code: organization!.code!,
          serviceIds: yandexRestaurantIds.split(","),
        }),
        // @ts-ignore
        merchantApiClient.api.express.post({
          date,
          terminal_id,
          organization_code: organization!.code!,
        }),
        // @ts-ignore
        merchantApiClient.api.arryt.post({
          date,
          terminal_id,
        }),
      ]);

      const reportItems = [];

      if (clickReportResult.status == "rejected") {
        set.status = 400;
        return {
          message: clickReportResult.reason,
        };
      } else {
        const clickReportGroup = reportGroups.find(
          (group) => group.code === "click"
        );
        reportItems.push({
          label: "Click",
          amount:
            clickReportResult.value.data &&
            typeof clickReportResult.value.data == "number"
              ? clickReportResult.value.data
              : 0,
          type: "income",
          group_id: clickReportGroup?.id ?? "",
          source: "click",
          report_id: "",
          report_date: reports?.date ?? date,
        });
      }

      if (paymeReportResult.status == "rejected") {
        set.status = 400;
        return {
          message: paymeReportResult.reason,
        };
      } else {
        const paymeReportGroup = reportGroups.find(
          (group) => group.code === "payme"
        );

        reportItems.push({
          label: "Payme",
          amount:
            paymeReportResult.value.data &&
            typeof paymeReportResult.value.data == "number"
              ? paymeReportResult.value.data
              : 0,
          type: "income",
          group_id: paymeReportGroup?.id ?? "",
          source: "payme",
          report_id: "",
          report_date: reports?.date ?? date,
        });
      }

      if (yandexReportResult.status == "rejected") {
        set.status = 400;
        return {
          message: yandexReportResult.reason,
        };
      } else {
        const yandexReportGroup = reportGroups.find(
          (group) => group.code === "yandex_eats"
        );

        reportItems.push({
          label: "Yandex",
          amount:
            yandexReportResult.value.data &&
            typeof yandexReportResult.value.data == "number"
              ? yandexReportResult.value.data
              : 0,
          type: "income",
          group_id: yandexReportGroup?.id ?? "",
          source: "yandex_eats",
          report_id: "",
          report_date: reports?.date ?? date,
        });
      }

      if (expressReportResult.status == "rejected") {
        set.status = 400;
        return {
          message: expressReportResult.reason,
        };
      } else {
        const expressReportGroup = reportGroups.find(
          (group) => group.code === "express24"
        );
        const myuzcardReportGroup = reportGroups.find(
          (group) => group.code === "myuzcard"
        );
        let expressData = expressReportResult.value.data;
        console.log("expressData", expressData);
        if (expressData && "express" in expressData) {
          reportItems.push({
            label: "Express24",
            amount: expressData.express,
            type: "income",
            group_id: expressReportGroup?.id ?? "",
            source: "express24",
            report_id: "",
            report_date: reports?.date ?? date,
          });
          reportItems.push({
            label: "Myuzcard",
            amount: expressData.card,
            type: "income",
            group_id: myuzcardReportGroup?.id ?? "",
            source: "myuzcard",
            report_id: "",
            report_date: reports?.date ?? date,
          });
        } else {
          reportItems.push({
            label: "Express24",
            amount: 0,
            type: "income",
            group_id: expressReportGroup?.id ?? "",
            source: "express24",
            report_id: "",
            report_date: reports?.date ?? date,
          });
          reportItems.push({
            label: "Myuzcard",
            amount: 0,
            type: "income",
            group_id: myuzcardReportGroup?.id ?? "",
            source: "myuzcard",
            report_id: "",
            report_date: reports?.date ?? date,
          });
        }
      }

      for (const item of incomes) {
        const group = reportGroups.find((group) => group.code === item.type);

        reportItems.push({
          label: item.label,
          amount: item.amount ?? 0,
          type: "income",
          group_id: group?.id,
          source: item.type,
          report_id: "",
          report_date: reports?.date ?? date,
        });
      }

      if (arrytReportResult.status == "rejected") {
        set.status = 400;
        return {
          message: arrytReportResult.reason,
        };
      } else {
        const arrytReportGroup = reportGroups.find(
          (group) => group.code === "arryt"
        );
        if (
          arrytReportResult.value.data &&
          "customerPrice" in arrytReportResult.value.data &&
          arrytReportResult.value.data.customerPrice > 0
        ) {
          reportItems.push({
            label: "Yandex Sarvar",
            amount: arrytReportResult.value.data.customerPrice,
            type: "income",
            group_id: arrytReportGroup?.id,
            source: "arryt",
            report_id: "",
          });
        }

        if (
          arrytReportResult.value.data &&
          "withdraws" in arrytReportResult.value.data
        ) {
          arrytReportResult.value.data.withdraws.forEach((item: any) => {
            reportItems.push({
              label: item.name,
              amount: item.amount ?? 0,
              type: "outcome",
              group_id: arrytReportGroup?.id,
              source: "arryt",
              report_id: "",
              report_date: reports?.date ?? date,
            });
          });
        }
      }

      if (iikoCachierReport.status == "rejected") {
        set.status = 400;
        return {
          message: iikoCachierReport.reason,
        };
      }

      for (const item of expenses) {
        const group = reportGroups.find(
          (group) => group.code === "other_expenses"
        );

        reportItems.push({
          label: item.label,
          amount: item.amount ?? 0,
          type: "outcome",
          group_id: group?.id ?? "",
          source: "other_expenses",
          report_id: "",
          report_date: reports?.date ?? date,
        });
      }

      if (reportsList.length == 0) {
        let totalManagerPrice = 0;

        for (const item of reportItems) {
          totalManagerPrice += item.amount ?? 0;
        }

        let difference = 0;
        if (
          iikoCachierReport.value.data &&
          "totalSum" in iikoCachierReport.value.data &&
          iikoCachierReport.value.data.totalSum
        ) {
          difference =
            totalManagerPrice - iikoCachierReport.value.data.totalSum;
        }

        let arrytIncome = 0;
        if (
          arrytReportResult.value.data &&
          "customerPrice" in arrytReportResult.value.data &&
          arrytReportResult.value.data.customerPrice > 0
        ) {
          arrytIncome = arrytReportResult.value.data.customerPrice;
        }
        console.log("before adding report", date);
        let resReports = await drizzle
          .insert(reports)
          .values({
            date:
              typeof date == "number"
                ? dayjs.unix(+date).hour(0).minute(0).second(0).toISOString()
                : dayjs(date).hour(0).minute(0).second(0).toISOString(),
            terminal_id: terminal_id,
            status_id: sentReportStatus?.id ?? "",
            user_id: user.user.id,
            cash_ids:
              iikoCachierReport.value.data &&
              "cashIds" in iikoCachierReport.value.data
                ? iikoCachierReport.value.data.cashIds
                : [],
            total_amount:
              iikoCachierReport.value.data &&
              "totalSum" in iikoCachierReport.value.data
                ? iikoCachierReport.value.data.totalSum
                : 0,
            total_manager_price: totalManagerPrice,
            difference,
            arryt_income: arrytIncome,
          })
          .returning({
            id: reports.id,
            date: reports.date,
          })
          .execute();

        console.log("after adding report", date);
        // const reportsLogs = reportItems.map((item) => ({
        //     ...item,
        //     report_id: reports!.id,
        //     user_id: currentUser.id,
        //     retports_item_id: item.id,
        // }));

        const reportItemsData = reportItems.map((item) => ({
          ...item,
          report_id: resReports[0]!.id,
          report_date: resReports[0]!.date,
          type: item.type as "outcome" | "income",
        }));
        // @ts-ignore
        await drizzle.insert(reports_items).values(reportItemsData).execute();

        // await this.prisma.reports_items.createMany({
        //     data: reportItemsData,
        // });
      } else {
        let totalManagerPrice = 0;

        for (const item of reportItems) {
          totalManagerPrice += item.amount ?? 0;
        }
        let difference = 0;
        if (
          iikoCachierReport.value.data &&
          "totalSum" in iikoCachierReport.value.data &&
          iikoCachierReport.value.data.totalSum
        ) {
          difference =
            totalManagerPrice - iikoCachierReport.value.data.totalSum;
        }

        let arrytIncome = 0;
        if (
          arrytReportResult.value.data &&
          "customerPrice" in arrytReportResult.value.data &&
          arrytReportResult.value.data.customerPrice > 0
        ) {
          arrytIncome = arrytReportResult.value.data.customerPrice;
        }
        const reportItem = reportsList[0];
        await drizzle
          .delete(reports_items)
          .where(eq(reports_items.report_id, reportItem.id))
          .execute();

        await drizzle
          .update(reports)
          .set({
            cash_ids:
              iikoCachierReport.value.data &&
              "cashIds" in iikoCachierReport.value.data
                ? iikoCachierReport.value.data.cashIds
                : [],
            total_amount:
              iikoCachierReport.value.data &&
              "totalSum" in iikoCachierReport.value.data
                ? iikoCachierReport.value.data.totalSum
                : 0,
            total_manager_price: totalManagerPrice,
            difference,
            arryt_income: arrytIncome,
          })
          .where(eq(reports.id, reportItem.id))
          .execute();
        const reportItemsData = reportItems.map((item) => ({
          ...item,
          report_id: reportItem!.id,
          report_date: reportItem!.date,
          type: item.type as "outcome" | "income",
        }));
        // @ts-ignore
        await drizzle.insert(reports_items).values(reportItemsData).execute();
      }
    },
    {
      body: t.Object({
        terminal_id: t.String(),
        date: t.Union([t.String(), t.Number()]),
        incomes: t.Array(
          t.Object({
            type: t.String(),
            amount: t.Nullable(t.Number()),
            error: t.Nullable(t.String()),
            readonly: t.Boolean(),
            label: t.String(),
          })
        ),
        expenses: t.Array(
          t.Object({
            type: t.String(),
            amount: t.Number(),
            error: t.String(),
            label: t.String(),
          })
        ),
      }),
    }
  )
  .put(
    "/reports/:id",
    async ({
      params: { id },
      body: { data },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports.edit")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const report = await drizzle
        .update(reports)
        .set(data)
        .where(eq(reports.id, id))
        .execute();
      return report;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        data: t.Object({
          status_id: t.String(),
        }),
      }),
    }
  )
  .delete(
    "/reports/:id",
    async ({ params: { id }, user, set, drizzle, cacheController }) => {
      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      if (!user.permissions.includes("reports.delete")) {
        set.status = 401;
        return {
          message: "You don't have permissions",
        };
      }
      const report = await drizzle
        .delete(reports)
        .where(eq(reports.id, id))
        .execute();
      return report;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
