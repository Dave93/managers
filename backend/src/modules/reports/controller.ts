import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  reports,
  reports_items,
  reports_status,
  terminals,
  users_terminals,
  users,
} from "@backend/../drizzle/schema";
import { sql, and, SQLWrapper, eq, inArray, desc, ne } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";
import { ReportsWithRelations } from "./dto/list.dto";
import dayjs from "dayjs";

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
      if (user?.terminals && user.terminals.length > 0) {
        whereClause.push(inArray(reports.terminal_id, user.terminals));
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
      permission: "reports.list",
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
      cacheController,
      error,
    }) => {

      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      let selectFields: SelectedFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, reports, {
          reports_status,
        });
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, reports, {
          reports_status,
        });
      }
      whereClause.push(eq(reports.terminal_id, terminal_id));
      const reportsList = (await drizzle
        .select(selectFields)
        .from(reports)
        .leftJoin(reports_status, eq(reports.status_id, reports_status.id))
        .where(and(...whereClause))
        .execute()) as ReportsWithRelations[];
      return reportsList;
    },
    {
      permission: "reports.list",
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
      const report = await drizzle
        .select()
        .from(reports)
        .where(eq(reports.id, id))
        .execute();
      return report[0];
    },
    {
      permission: "reports.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  .get(
    "/reports/is_editable",
    async ({
      query: { date, terminal_id },
      user,
      cacheController,
      error,
      drizzle,
    }) => {

      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
        })
        .from(reports)
        .where(
          and(
            eq(reports.date, filterDate),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();
      const report = reportList[0];

      if (report) {
        return !checkingStatusIds.includes(report.status_id);
      }
      return true;
    },
    {
      permission: "reports.list",
      query: t.Object({
        date: t.String(),
        terminal_id: t.String(),
      }),
    }
  )
  .post(
    "/reports/click",
    async ({
      body: { date, terminal_id, time },
      user,
      cacheController,
      drizzle,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();
      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
        })
        .from(reports)
        .where(
          and(
            eq(reports.date, filterDate),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();
      const report = reportList[0];

      let result = 0;
      if (report && checkingStatusIds.includes(report.status_id)) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              eq(reports_items.source, "click")
            )
          )
          .execute();
        result = reportItems.reduce((acc, item) => acc + (item.amount ?? 0), 0);
      } else {
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
          return error(400, "Click service ids not found");
        }

        const workStartTime = (
          await cacheController.getCachedSetting("main.workStartTime")
        )?.value;
        const workEndTime = (
          await cacheController.getCachedSetting("main.workEndTime")
        )?.value;

        const clickResult = await cacheController.getClickData(
          filterDate,
          clickServiceIds,
          workStartTime,
          workEndTime,
          time
        );

        result = clickResult ?? 0;
      }

      return result;
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/express",
    async ({
      body: { date, terminal_id, time },
      user,
      drizzle,
      cacheController,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();
      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
        })
        .from(reports)
        .where(
          and(
            eq(reports.date, filterDate),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();
      const report = reportList[0];

      let result: {
        express: number;
        yandex_eats: number;
        my_uzcard: number;
        wolt: number;
      } = {
        express: 0,
        yandex_eats: 0,
        my_uzcard: 0,
        wolt: 0,
      };

      if (report && checkingStatusIds.includes(report.status_id)) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              inArray(reports_items.source, [
                "express",
                "yandex_eats",
                "my_uzcard",
                "wolt",
              ])
            )
          )
          .execute();
        result = reportItems.reduce(
          (acc, item) => {
            acc[item.source as keyof typeof acc] += item.amount ?? 0;
            return acc;
          },
          {
            express: 0,
            yandex_eats: 0,
            my_uzcard: 0,
            wolt: 0,
          }
        );
      } else {
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
          return error(400, "Click service ids not found");
        }
        const workStartTime = (
          await cacheController.getCachedSetting("main.workStartTime")
        )?.value;
        const workEndTime = (
          await cacheController.getCachedSetting("main.workEndTime")
        )?.value;

        const terminals = await cacheController.getCachedTerminals({});
        const terminal = terminals.find((t) => t.id === terminal_id);

        if (!terminal) {
          return error(400, "Terminal not found");
        }

        const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

        if (!iikoId) {
          return error(400, "Iiko id not found");
        }

        const organizations = await cacheController.getCachedOrganization({});
        const organization = organizations.find(
          (org) => org.id === terminal.organization_id
        );

        if (!organization) {
          return error(400, "Organization not found");
        }

        result = await cacheController.getExpressData(
          filterDate,
          iikoId,
          workStartTime,
          workEndTime,
          organization!.code!.toUpperCase(),
          time
        );
      }

      // return result.result.data;
      return result;
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/cashier",
    async ({
      body: { date, terminal_id },
      user,
      drizzle,
      cacheController,
      error,
    }) => {

      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const terminal = terminals.find((t) => t.id === terminal_id);
      if (!terminal) {
        return error(400, "Terminal not found");
      }

      const allCredentials = await cacheController.getCachedCredentials({});
      const credentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal_id &&
          credential.model === "terminals"
      );

      const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

      if (!iikoId) {
        return error(400, "Iiko id not found");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      let result = {
        terminal,
        totalCashier: 0,
      };
      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
          total_amount: reports.total_amount,
        })
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

      const report = reportList[0];

      if (report && checkingStatusIds.includes(report.status_id)) {
        result.totalCashier = report.total_amount ?? 0;
      } else {
        result.totalCashier = await cacheController.getIikoData(
          filterDate,
          iikoId
        );
      }

      return result;
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/arryt",
    async ({
      body: { date, terminal_id, time },
      user,
      drizzle,
      cacheController,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const terminal = terminals.find((t) => t.id === terminal_id);
      if (!terminal) {
        return error(400, "Terminal not found");
      }

      const allCredentials = await cacheController.getCachedCredentials({});
      const credentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal_id &&
          credential.model === "terminals"
      );

      const organizationCredentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal.organization_id &&
          credential.model === "organization"
      );

      const organizationArrytToken = organizationCredentials.find(
        (credential) => credential.type === "arryt_token"
      )?.key;

      const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

      if (!iikoId) {
        return error(400, "Iiko id not found");
      }

      const workStartTime = (
        await cacheController.getCachedSetting("main.workStartTime")
      )?.value;
      const workEndTime = (
        await cacheController.getCachedSetting("main.workEndTime")
      )?.value;

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
          total_amount: reports.total_amount,
          arryt_income: reports.arryt_income,
        })
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

      const report = reportList[0];

      if (report && checkingStatusIds.includes(report.status_id)) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              eq(reports_items.source, "arryt")
            )
          )
          .execute();

        return {
          customerPrice: report.arryt_income ?? 0,
          withdraws: reportItems.map((item) => ({
            first_name: item.label.split(" ")[0],
            last_name: item.label.split(" ")[1],
            amount: item.amount ?? 0,
          })),
        };
      } else {
        return await cacheController.getArrytData(
          filterDate,
          iikoId,
          workStartTime,
          workEndTime,
          organizationArrytToken!,
          time
        );
      }
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/payme",
    async ({
      body: { date, terminal_id, time },
      user,
      cacheController,
      drizzle,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const terminal = terminals.find((t) => t.id === terminal_id);
      if (!terminal) {
        return error(400, "Terminal not found");
      }

      const allCredentials = await cacheController.getCachedCredentials({});
      const credentials = allCredentials.filter(
        (credential) =>
          credential.model_id === terminal_id &&
          credential.model === "terminals"
      );

      const paymeMerchantIds = credentials.find(
        (c) => c.type === "payme_merchant_ids"
      )?.key;
      if (!paymeMerchantIds) {
        return error(400, "Payme merchant ids not found");
      }

      const paymeBusinessId = credentials.find(
        (c) => c.type === "payme_business_id"
      )?.key;
      if (!paymeBusinessId) {
        return error(400, "Payme business id not found");
      }

      const workStartTime = (
        await cacheController.getCachedSetting("main.workStartTime")
      )?.value;
      const workEndTime = (
        await cacheController.getCachedSetting("main.workEndTime")
      )?.value;

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);

      const reportList = await drizzle
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.date, filterDate),
            eq(reports.terminal_id, terminal_id)
          )
        )
        .execute();

      const report = reportList[0];

      if (report && checkingStatusIds.includes(report.status_id)) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              eq(reports_items.source, "payme")
            )
          )
          .execute();

        if (reportItems.length > 0) {
          return reportItems[0].amount ?? 0;
        } else {
          return 0;
        }
      } else {
        const result = await cacheController.getPaymeData(
          filterDate,
          paymeMerchantIds,
          paymeBusinessId,
          workStartTime,
          workEndTime,
          time
        );
        return result;
      }
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/editable-incomes",
    async ({
      body: { date, terminal_id },
      user,
      cacheController,
      drizzle,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const terminal = terminals.find((t) => t.id === terminal_id);
      if (!terminal) {
        return error(400, "Terminal not found");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
          total_amount: reports.total_amount,
        })
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

      const report = reportList[0];

      if (report) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              eq(reports_items.type, "income"),
              inArray(reports_items.source, ["cash", "uzcard", "humo", "uzum"])
            )
          )
          .execute();
        if (checkingStatusIds.includes(report.status_id)) {
          return reportItems.map((item) => ({
            key: item.source,
            readonly: true,
            value: item.amount ?? 0,
          }));
        } else {
          return reportItems.map((item) => ({
            key: item.source,
            readonly: false,
            value: item.amount ?? 0,
          }));
        }
      } else {
        return [
          {
            key: "cash",
            readonly: false,
            value: 0,
          },
          {
            key: "uzcard",
            readonly: false,
            value: 0,
          },
          {
            key: "humo",
            readonly: false,
            value: 0,
          },
          {
            key: "uzum",
            readonly: false,
            value: 0,
          },
        ];
      }
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
        time: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/reports/editable-expenses",
    async ({
      body: { date, terminal_id },
      user,
      cacheController,
      drizzle,
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const terminal = terminals.find((t) => t.id === terminal_id);
      if (!terminal) {
        return error(400, "Terminal not found");
      }

      const filterDate = dayjs
        .unix(+date)
        .hour(0)
        .minute(0)
        .second(0)
        .toISOString();

      const reportStatuses = await cacheController.getCachedReportStatuses({});
      const checkingStatusIds = reportStatuses
        .filter((status) => ["checking", "confirmed"].includes(status.code))
        .map((status) => status.id);
      const reportList = await drizzle
        .select({
          id: reports.id,
          status_id: reports.status_id,
          total_amount: reports.total_amount,
        })
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

      const report = reportList[0];

      if (report) {
        const reportItems = await drizzle
          .select()
          .from(reports_items)
          .where(
            and(
              eq(reports_items.report_id, report.id),
              eq(reports_items.type, "outcome"),
              ne(reports_items.source, "arryt")
            )
          )
          .execute();

        if (checkingStatusIds.includes(report.status_id)) {
          return reportItems.map((item) => ({
            label: item.label,
            readonly: true,
            value: item.amount ?? 0,
          }));
        } else {
          return reportItems.map((item) => ({
            label: item.label,
            readonly: false,
            value: item.amount ?? 0,
          }));
        }
      } else {
        return [
          {
            label: "Основание",
            readonly: false,
            value: 0,
          },
        ];
      }
    },
    {
      permission: "reports.list",
      body: t.Object({
        date: t.String(),
        terminal_id: t.String(),
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
      error,
    }) => {
      if (!user?.terminals || !user?.terminals.includes(terminal_id)) {
        return error(401, "You don't have permissions");
      }

      const terminals = await cacheController.getCachedTerminals({});
      const chosenTerminal = terminals.find((t) => t.id === terminal_id);
      if (!chosenTerminal) {
        return error(400, "Terminal not found");
      }

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
        terminal_name: chosenTerminal.name!,
        terminal_id: chosenTerminal.id,
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

      const reportItem = reportsList[0];

      const reportStatuses = await cacheController.getCachedReportStatuses({});

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

      const organizationCredentials = allCredentials.filter(
        (credential) =>
          credential.model_id === chosenTerminal.organization_id &&
          credential.model === "organization"
      );

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

      const workStartTime = (
        await cacheController.getCachedSetting("main.workStartTime")
      )?.value;
      const workEndTime = (
        await cacheController.getCachedSetting("main.workEndTime")
      )?.value;

      const organizationArrytToken = organizationCredentials.find(
        (credential) => credential.type === "arryt_token"
      )?.key;

      const [
        clickReportResult,
        paymeReportResult,
        iikoCachierReport,
        expressReportResult,
        arrytReportResult,
        iikoCachierData,
      ] = await Promise.all([
        cacheController.getClickData(
          date,
          clickServiceIds,
          workStartTime,
          workEndTime
        ),
        cacheController.getPaymeData(
          date,
          paymeMerchantIds,
          paymeBusinessId,
          workStartTime,
          workEndTime
        ),
        cacheController.getIikoData(date, iikoId),
        cacheController.getExpressData(
          date,
          iikoId,
          workStartTime,
          workEndTime,
          organization!.code!.toUpperCase()
        ),
        cacheController.getArrytData(
          date,
          iikoId,
          workStartTime,
          workEndTime,
          organizationArrytToken!
        ),
        cacheController.getIikoCachierData(date, iikoId),
      ]);

      const reportItems = [];

      reportItems.push({
        label: "Click",
        amount: clickReportResult ? clickReportResult : 0,
        type: "income",
        source: "click",
        report_id: "",
        report_date: reportItem?.date ?? date,
      });

      reportItems.push({
        label: "Payme",
        amount: paymeReportResult ? paymeReportResult : 0,
        type: "income",
        source: "payme",
        report_id: "",
        report_date: reportItem?.date ?? date,
      });

      // reportItems.push({
      //   label: "Express24",
      //   amount:
      //     expressReportResult && "express" in expressReportResult
      //       ? expressReportResult.express
      //       : 0,
      //   type: "income",
      //   source: "express",
      //   report_id: "",
      //   report_date: reportItem?.date ?? date,
      // });

      reportItems.push({
        label: "Yandex Eats",
        amount:
          expressReportResult && "yandex_eats" in expressReportResult
            ? expressReportResult.yandex_eats
            : 0,
        type: "income",
        source: "yandex_eats",
        report_id: "",
        report_date: reportItem?.date ?? date,
      });

      reportItems.push({
        label: "My Uzcard",
        amount:
          expressReportResult && "my_uzcard" in expressReportResult
            ? expressReportResult.my_uzcard
            : 0,
        type: "income",
        source: "my_uzcard",
        report_id: "",
        report_date: reportItem?.date ?? date,
      });

      reportItems.push({
        label: "Wolt",
        amount:
          expressReportResult && "wolt" in expressReportResult
            ? expressReportResult.wolt
            : 0,
        type: "income",
        source: "wolt",
        report_id: "",
        report_date: reportItem?.date ?? date,
      });

      for (const item of incomes) {
        reportItems.push({
          label: item.label,
          amount: item.amount ?? 0,
          type: "income",
          source: item.type,
          report_id: "",
          report_date: reportItem?.date ?? date,
        });
      }

      if (arrytReportResult && "withdraws" in arrytReportResult) {
        for (const item of arrytReportResult.withdraws) {
          reportItems.push({
            label: item.first_name + " " + item.last_name,
            amount: item.amount,
            type: "outcome",
            source: "arryt",
            report_id: "",
            report_date: reportItem?.date ?? date,
          });
        }
      }

      for (const item of expenses) {
        reportItems.push({
          label: item.label,
          amount: item.amount ?? 0,
          type: "outcome",
          source: "other_expenses",
          report_id: "",
          report_date: reportItem?.date ?? date,
        });
      }

      if (reportsList.length == 0) {
        let totalManagerPrice = 0;

        for (const item of reportItems) {
          totalManagerPrice += item.amount ?? 0;
        }

        let difference = 0;
        if (iikoCachierReport && iikoCachierReport > 0) {
          difference = totalManagerPrice - iikoCachierReport;
        }

        let arrytIncome = 0;
        if (arrytReportResult && "customerPrice" in arrytReportResult) {
          arrytIncome = arrytReportResult.customerPrice;
        }
        let resReports = await drizzle
          .insert(reports)
          .values({
            date:
              typeof date == "number"
                ? dayjs.unix(+date).hour(0).minute(0).second(0).toISOString()
                : dayjs(date).hour(0).minute(0).second(0).toISOString(),
            terminal_id: terminal_id,
            status_id: sentReportStatus?.id ?? "",
            user_id: user!.user.id,
            cash_ids: iikoCachierData,
            total_amount: iikoCachierReport ? iikoCachierReport : 0,
            total_manager_price: totalManagerPrice,
            difference,
            arryt_income: arrytIncome,
          })
          .returning({
            id: reports.id,
            date: reports.date,
          })
          .execute();

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
        if (iikoCachierReport && iikoCachierReport > 0) {
          difference = totalManagerPrice - iikoCachierReport;
        }

        let arrytIncome = 0;
        if (arrytReportResult && "customerPrice" in arrytReportResult) {
          arrytIncome = arrytReportResult.customerPrice;
        }
        const reportItem = reportsList[0];
        await drizzle
          .delete(reports_items)
          .where(eq(reports_items.report_id, reportItem.id))
          .execute();

        await drizzle
          .update(reports)
          .set({
            cash_ids: iikoCachierData,
            total_amount: iikoCachierReport ? iikoCachierReport : 0,
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
        await drizzle.insert(reports_items).values(reportItemsData).execute();
        return {
          success: true,
        };
      }
    },
    {
      permission: "reports.add",
      body: t.Object({
        terminal_id: t.String(),
        date: t.Union([t.String(), t.Number()]),
        incomes: t.Array(
          t.Object({
            type: t.String(),
            amount: t.Nullable(t.Number()),
            readonly: t.Boolean(),
            label: t.String(),
          })
        ),
        expenses: t.Array(
          t.Object({
            type: t.String(),
            amount: t.Number(),
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
      const report = await drizzle
        .update(reports)
        .set(data)
        .where(eq(reports.id, id))
        .execute();
      return report;
    },
    {
      permission: "reports.edit",
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
      const report = await drizzle
        .delete(reports)
        .where(eq(reports.id, id))
        .execute();
      return report;
    },
    {
      permission: "reports.delete",
      params: t.Object({
        id: t.String(),
      }),
    }
  );
