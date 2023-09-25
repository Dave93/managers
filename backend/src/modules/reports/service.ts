import { DB } from "@backend/db";
import { PaginationType } from "@backend/lib/pagination_interface";
import {
  Reports,
  ReportsFindManyArgsSchema,
  ReportsWithRelations,
  UsersWithRelations,
} from "@backend/lib/zod";
import { Prisma, Reports_items, Users, report_item_type } from "@prisma/client";
import { date, z } from "zod";
import { TRPCError } from "@trpc/server";
import { ReportsFindUniqueForTerminal } from "./dto/one.dto";
import dayjs from "dayjs";
import { merchantTrpcClient } from "@backend/lib/merchant-trpc-server";
import { CacheControlService } from "../cache_control/service";
import {
  UniqueReportsByDayInputSchema,
  UniqueReportsByDayOutputSchema,
  UniqueSetReportDataInputSchema,
} from "@backend/lib/z_objects";

export class ReportsService {
  constructor(
    private readonly prisma: DB,
    private readonly cacheControl: CacheControlService
  ) {}

  async create(input: Prisma.ReportsCreateArgs): Promise<Reports> {
    return this.prisma.reports.create(input);
  }

  async findMany(
    input: z.infer<typeof ReportsFindManyArgsSchema>,
    currentUser: Omit<UsersWithRelations, "password">
  ): Promise<PaginationType<ReportsWithRelations>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;

    const [reports, meta] = await this.prisma.reports
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });
    return {
      items: reports as ReportsWithRelations[],
      meta,
    };
  }

  async findOne(
    input: z.infer<typeof ReportsFindUniqueForTerminal>,
    currentUser: Omit<UsersWithRelations, "password">
  ): Promise<Reports | null> {
    const terminals = await this.prisma.users_terminals.findMany({
      where: {
        user_id: currentUser.id,
      },
      select: {
        terminal_id: true,
      },
    });

    const chosenTerminal = terminals.find(
      (terminal) => terminal.terminal_id === input.terminal_id
    );

    if (!chosenTerminal) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    return await this.prisma.reports.findUnique(input);
  }

  async update(input: Prisma.ReportsUpdateArgs): Promise<Reports> {
    //set log for reports_logs update
    const report = await this.prisma.reports.findUnique({
      where: {
        id: input.where.id,
      },
    });

    return await this.prisma.reports.update(input);
  }

  async delete(input: Prisma.ReportsDeleteArgs) {
    return await this.prisma.reports.delete(input);
  }

  async getReportsByMonth(
    input: z.infer<typeof ReportsFindManyArgsSchema>,
    currentUser: Omit<UsersWithRelations, "password">
  ): Promise<ReportsWithRelations[]> {
    const terminals = await this.prisma.users_terminals.findMany({
      where: {
        user_id: currentUser.id,
      },
      select: {
        terminal_id: true,
      },
    });

    const terminalId = input.where?.terminal_id;

    const chosenTerminal = terminals.find(
      (terminal) => terminal.terminal_id === terminalId
    );

    if (!chosenTerminal) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    const reports = (await this.prisma.reports.findMany(
      input
    )) as ReportsWithRelations[];
    return reports;
  }

  async getUniqueReportsByDay(
    input: z.infer<typeof UniqueReportsByDayInputSchema>,
    currentUser: Omit<UsersWithRelations, "password">
  ): Promise<z.infer<typeof UniqueReportsByDayOutputSchema>> {
    const result: z.infer<typeof UniqueReportsByDayOutputSchema> = {
      terminal_name: "",
      terminal_id: "",
      incomes: [],
      expenses: [],
      totalCashier: 0,
      editable: true,
    };
    const terminals = await this.prisma.users_terminals.findMany({
      where: {
        user_id: currentUser.id,
      },
      select: {
        terminal_id: true,
        terminals: {
          select: {
            organization_id: true,
            name: true,
          },
        },
      },
    });

    const terminalId = input.terminal_id;

    const chosenTerminal = terminals.find(
      (terminal) => terminal.terminal_id === terminalId
    );

    if (!chosenTerminal) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    result.terminal_id = chosenTerminal.terminal_id;
    result.terminal_name = chosenTerminal.terminals?.name ?? "";

    const reports = await this.prisma.reports.findFirst({
      where: {
        terminal_id: input.terminal_id,
        date: dayjs.unix(+input.date).hour(0).minute(0).second(0).toDate(),
      },
    });

    const reportStatuses = await this.cacheControl.getCachedReportStatuses({});

    const editableStatusIds = reportStatuses
      .filter((status) => status.code === "sent" || status.code === "cancelled")
      .map((status) => status.id);

    const allCredentials = await this.cacheControl.getCachedCredentials({});
    const credentials = allCredentials.filter(
      (credential) =>
        credential.model_id === input.terminal_id &&
        credential.model === "terminals"
    );

    const clickServiceIds = credentials.find(
      (c) => c.type === "click_service_ids"
    )?.key;

    const paymeBusinessId = credentials.find(
      (c) => c.type === "payme_business_id"
    )?.key;

    const paymeMerchantIds = credentials.find(
      (c) => c.type === "payme_merchant_ids"
    )?.key;

    const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

    const yandexRestaurantIds = credentials.find(
      (c) => c.type === "yandex_restaurant_id"
    )?.key;

    const organizations = await this.cacheControl.getCachedOrganization({});
    const organization = organizations.find(
      (org) => org.id === chosenTerminal?.terminals?.organization_id
    );

    let date = input.date;

    if (!date) {
      date = dayjs().toISOString();
    }

    date = dayjs.unix(+input.date).toISOString();
    if (!reports) {
      const [
        clickReportResult,
        paymeReportResult,
        iikoCachierReport,
        yandexReportResult,
        expressReportResult,
        arrytReportResult,
      ] = await Promise.allSettled([
        merchantTrpcClient.getClickReport.query({
          serviceIds: clickServiceIds?.split(",") ?? [],
          date,
          time: input.time,
        }),
        merchantTrpcClient.getPaymeReport.query({
          businessId: paymeBusinessId ?? "",
          serviceIds: paymeMerchantIds?.split(",") ?? [],
          date,
          time: input.time,
        }),
        merchantTrpcClient.getIikoCachierReport.query({
          groupId: iikoId ?? "",
          date,
        }),
        merchantTrpcClient.getYandexReport.query({
          organization_code: organization?.code ?? "",
          serviceIds: yandexRestaurantIds?.split(",") ?? [],
          date,
          time: input.time,
        }),
        merchantTrpcClient.getExpressReport.query({
          organization_code: organization?.code ?? "",
          date,
          terminal_id: input.terminal_id,
          time: input.time,
        }),
        merchantTrpcClient.getArrytReport.query({
          date,
          terminal_id: input.terminal_id,
          time: input.time,
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
          amount: clickReportResult.value,
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
          amount: paymeReportResult.value,
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
          amount: yandexReportResult.value,
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
      } else {
        result.incomes.push({
          error: null,
          amount: expressReportResult.value,
          type: "express24",
          readonly: true,
          label: "Express24",
        });
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
          arrytReportResult.value.customerPrice &&
          arrytReportResult.value.customerPrice > 0
        ) {
          result.incomes.push({
            error: null,
            amount: arrytReportResult.value.customerPrice,
            type: "yandex_delivery",
            readonly: true,
            label: "Yandex Sarvar",
          });
        }
        arrytReportResult.value.withdraws.forEach((item) => {
          result.expenses.push({
            error: null,
            amount: item.amount,
            type: "arryt",
            label: item.name,
          });
        });
      }
      if (iikoCachierReport.status == "fulfilled") {
        result.totalCashier = iikoCachierReport.value.totalSum;
      }
    } else {
      if (editableStatusIds.includes(reports.status_id)) {
        const existingReportItems = await this.prisma.reports_items.findMany({
          where: {
            source: {
              in: ["cash", "uzcard", "humo", "uzum_tezkor", "other_expenses"],
            },
            report_id: reports.id,
          },
        });

        const [
          clickReportResult,
          paymeReportResult,
          iikoCachierReport,
          yandexReportResult,
          expressReportResult,
          arrytReportResult,
        ] = await Promise.allSettled([
          merchantTrpcClient.getClickReport.query({
            serviceIds: clickServiceIds?.split(",") ?? [],
            date,
            time: input.time,
          }),
          merchantTrpcClient.getPaymeReport.query({
            businessId: paymeBusinessId ?? "",
            serviceIds: paymeMerchantIds?.split(",") ?? [],
            date,
            time: input.time,
          }),
          merchantTrpcClient.getIikoCachierReport.query({
            groupId: iikoId ?? "",
            date,
          }),
          merchantTrpcClient.getYandexReport.query({
            organization_code: organization?.code ?? "",
            serviceIds: yandexRestaurantIds?.split(",") ?? [],
            date,
            time: input.time,
          }),
          merchantTrpcClient.getExpressReport.query({
            organization_code: organization?.code ?? "",
            date,
            terminal_id: input.terminal_id,
            time: input.time,
          }),
          merchantTrpcClient.getArrytReport.query({
            date,
            terminal_id: input.terminal_id,
            time: input.time,
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

        result.incomes.push({
          amount: cashReportItem?.amount ?? 0,
          error: null,
          type: "cash",
          readonly: false,
          label: "Наличными",
        });

        result.incomes.push({
          amount: uzcardReportItem?.amount ?? 0,
          error: null,
          type: "uzcard",
          readonly: false,
          label: "Терминал",
        });

        result.incomes.push({
          amount: humoReportItem?.amount ?? 0,
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
            amount: clickReportResult.value,
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
            amount: paymeReportResult.value,
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
            amount: yandexReportResult.value,
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
        } else {
          result.incomes.push({
            error: null,
            amount: expressReportResult.value,
            type: "express24",
            readonly: true,
            label: "Express24",
          });
        }

        result.incomes.push({
          amount: uzumTezkorReportItem?.amount ?? 0,
          error: null,
          type: "uzum_tezkor",
          readonly: false,
          label: "Uzum Tezkor",
        });

        if (arrytReportResult.status == "rejected") {
        } else {
          if (
            arrytReportResult.value.customerPrice &&
            arrytReportResult.value.customerPrice > 0
          ) {
            result.incomes.push({
              error: null,
              amount: arrytReportResult.value.customerPrice,
              type: "yandex_delivery",
              readonly: true,
              label: "Yandex Sarvar",
            });
          }
          arrytReportResult.value.withdraws.forEach((item) => {
            result.expenses.push({
              error: null,
              amount: item.amount,
              type: "arryt",
              label: item.name,
            });
          });
        }

        const otherExpensesReportItems = existingReportItems.filter(
          (item) => item.source === "other_expenses"
        );

        for (const item of otherExpensesReportItems) {
          result.expenses.push({
            error: null,
            amount: item.amount,
            type: "other_expenses",
            label: item.label,
          });
        }

        if (iikoCachierReport.status == "fulfilled") {
          result.totalCashier = iikoCachierReport.value.totalSum;
        }
      } else {
        result.editable = false;

        result.totalCashier = reports.total_amount;

        const reportItems = await this.prisma.reports_items.findMany({
          where: {
            report_id: reports.id,
          },
        });

        for (const item of reportItems) {
          if (item.type === report_item_type.income) {
            result.incomes.push({
              amount: item.amount,
              error: null,
              type: item.source,
              readonly: true,
              label: item.label,
            });
          } else {
            result.expenses.push({
              amount: item.amount,
              error: null,
              type: item.source,
              label: item.label,
            });
          }
        }
      }
    }
    return result;
  }

  async setReportData(
    input: z.infer<typeof UniqueSetReportDataInputSchema>,
    currentUser: Omit<UsersWithRelations, "password">
  ) {
    const terminals = await this.prisma.users_terminals.findMany({
      where: {
        user_id: currentUser.id,
      },
      select: {
        terminal_id: true,
        terminals: {
          select: {
            organization_id: true,
            name: true,
          },
        },
      },
    });

    const terminalId = input.terminal_id;

    const chosenTerminal = terminals.find(
      (terminal) => terminal.terminal_id === terminalId
    );

    if (!chosenTerminal) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }
    let reports = await this.prisma.reports.findFirst({
      where: {
        terminal_id: input.terminal_id,
        date: dayjs.unix(+input.date).hour(0).minute(0).second(0).toDate(),
      },
    });

    const allCredentials = await this.cacheControl.getCachedCredentials({});
    const credentials = allCredentials.filter(
      (credential) =>
        credential.model_id === input.terminal_id &&
        credential.model === "terminals"
    );

    const clickServiceIds = credentials.find(
      (c) => c.type === "click_service_ids"
    )?.key;

    const paymeBusinessId = credentials.find(
      (c) => c.type === "payme_business_id"
    )?.key;

    const paymeMerchantIds = credentials.find(
      (c) => c.type === "payme_merchant_ids"
    )?.key;

    const iikoId = credentials.find((c) => c.type === "iiko_id")?.key;

    const yandexRestaurantIds = credentials.find(
      (c) => c.type === "yandex_restaurant_id"
    )?.key;

    const organizations = await this.cacheControl.getCachedOrganization({});
    const organization = organizations.find(
      (org) => org.id === chosenTerminal?.terminals?.organization_id
    );

    const reportGroups = await this.cacheControl.getCachedReportGroups({});

    const reportStatuses = await this.cacheControl.getCachedReportStatuses({});

    const sentReportStatus = reportStatuses.find(
      (status) => status.code === "sent"
    );

    if (reports) {
      const reportStatus = reportStatuses.find(
        (status) => status.id == reports?.status_id
      );
      if (
        reportStatus &&
        ["checking", "confirmed"].includes(reportStatus.code)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Обновление отчёта в текущем статусе невозможно",
        });
      }
    }

    let date = input.date;

    if (!date) {
      date = dayjs().toISOString();
    }

    date = dayjs.unix(+input.date).toISOString();
    const [
      clickReportResult,
      paymeReportResult,
      iikoCachierReport,
      yandexReportResult,
      expressReportResult,
      arrytReportResult,
    ] = await Promise.allSettled([
      merchantTrpcClient.getClickReport.query({
        serviceIds: clickServiceIds?.split(",") ?? [],
        date,
      }),
      merchantTrpcClient.getPaymeReport.query({
        businessId: paymeBusinessId ?? "",
        serviceIds: paymeMerchantIds?.split(",") ?? [],
        date,
      }),
      merchantTrpcClient.getIikoCachierReport.query({
        groupId: iikoId ?? "",
        date,
      }),
      merchantTrpcClient.getYandexReport.query({
        organization_code: organization?.code ?? "",
        serviceIds: yandexRestaurantIds?.split(",") ?? [],
        date,
      }),
      merchantTrpcClient.getExpressReport.query({
        organization_code: organization?.code ?? "",
        date,
        terminal_id: input.terminal_id,
      }),
      merchantTrpcClient.getArrytReport.query({
        date,
        terminal_id: input.terminal_id,
      }),
    ]);

    const reportItems: Prisma.Reports_itemsCreateManyInput[] = [];

    if (clickReportResult.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: clickReportResult.reason,
      });
    } else {
      const clickReportGroup = reportGroups.find(
        (group) => group.code === "click"
      );
      reportItems.push({
        label: "Click",
        amount: clickReportResult.value ?? 0,
        type: report_item_type.income,
        group_id: clickReportGroup?.id ?? "",
        source: "click",
        report_id: "",
      });
    }

    if (paymeReportResult.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: paymeReportResult.reason,
      });
    } else {
      const paymeReportGroup = reportGroups.find(
        (group) => group.code === "payme"
      );

      reportItems.push({
        label: "Payme",
        amount: paymeReportResult.value ?? 0,
        type: report_item_type.income,
        group_id: paymeReportGroup?.id ?? "",
        source: "payme",
        report_id: "",
      });
    }

    if (yandexReportResult.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: yandexReportResult.reason,
      });
    } else {
      const yandexReportGroup = reportGroups.find(
        (group) => group.code === "yandex_eats"
      );

      reportItems.push({
        label: "Yandex",
        amount: yandexReportResult.value ?? 0,
        type: report_item_type.income,
        group_id: yandexReportGroup?.id ?? "",
        source: "yandex_eats",
        report_id: "",
      });
    }

    if (expressReportResult.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: expressReportResult.reason,
      });
    } else {
      const expressReportGroup = reportGroups.find(
        (group) => group.code === "express24"
      );

      reportItems.push({
        label: "Express24",
        amount: expressReportResult.value ?? 0,
        type: report_item_type.income,
        group_id: expressReportGroup?.id ?? "",
        source: "express24",
        report_id: "",
      });
    }

    for (const item of input.incomes) {
      const group = reportGroups.find((group) => group.code === item.type);

      reportItems.push({
        label: item.label,
        amount: item.amount ?? 0,
        type: report_item_type.income,
        group_id: group?.id,
        source: item.type,
        report_id: "",
      });
    }

    if (arrytReportResult.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: arrytReportResult.reason,
      });
    } else {
      const arrytReportGroup = reportGroups.find(
        (group) => group.code === "arryt"
      );
      // if (
      //   arrytReportResult.value.customerPrice &&
      //   arrytReportResult.value.customerPrice > 0
      // ) {
      //   reportItems.push({
      //     group_id: arrytReportGroup?.id,
      //     amount: arrytReportResult.value.customerPrice,
      //     type: report_item_type.income,
      //     source: "arryt",
      //     label: "Yandex Sarvar",
      //     report_id: "",
      //   });
      // }

      arrytReportResult.value.withdraws.forEach((item) => {
        reportItems.push({
          label: item.name,
          amount: item.amount ?? 0,
          type: report_item_type.outcome,
          group_id: arrytReportGroup?.id,
          source: "arryt",
          report_id: "",
        });
      });
    }
    if (iikoCachierReport.status == "rejected") {
      throw new TRPCError({
        code: "UNPROCESSABLE_CONTENT",
        message: iikoCachierReport.reason,
      });
    }

    for (const item of input.expenses) {
      const group = reportGroups.find(
        (group) => group.code === "other_expenses"
      );

      reportItems.push({
        label: item.label,
        amount: item.amount ?? 0,
        type: report_item_type.outcome,
        group_id: group?.id ?? "",
        source: "other_expenses",
        report_id: "",
      });
    }

    if (!reports) {
      let totalManagerPrice = 0;

      for (const item of reportItems) {
        totalManagerPrice += item.amount ?? 0;
      }

      let difference = 0;
      if (iikoCachierReport.value.totalSum) {
        difference = totalManagerPrice - iikoCachierReport.value.totalSum;
      }

      let arrytIncome = 0;
      if (
        arrytReportResult.value.customerPrice &&
        arrytReportResult.value.customerPrice > 0
      ) {
        arrytIncome = arrytReportResult.value.customerPrice;
      }

      reports = await this.prisma.reports.create({
        data: {
          date: dayjs.unix(+input.date).hour(0).minute(0).second(0).toDate(),
          terminal_id: input.terminal_id,
          status_id: sentReportStatus?.id ?? "",
          user_id: currentUser.id,
          cash_ids: iikoCachierReport.value.cashIds,
          total_amount: iikoCachierReport.value.totalSum,
          total_manager_price: totalManagerPrice,
          difference,
          arryt_income: arrytIncome,
        },
      });

      const reportsLogs = reportItems.map((item) => ({
        ...item,
        report_id: reports!.id,
        user_id: currentUser.id,
        retports_item_id: item.id,
      }));

      const reportItemsData = reportItems.map((item) => ({
        ...item,
        report_id: reports!.id,
        report_date: reports!.date,
      }));
      await this.prisma.reports_items.createMany({
        data: reportItemsData,
      });
    } else {
      let totalManagerPrice = 0;

      for (const item of reportItems) {
        totalManagerPrice += item.amount ?? 0;
      }
      let difference = 0;
      if (iikoCachierReport.value.totalSum) {
        difference = totalManagerPrice - iikoCachierReport.value.totalSum;
      }

      let arrytIncome = 0;
      if (
        arrytReportResult.value.customerPrice &&
        arrytReportResult.value.customerPrice > 0
      ) {
        arrytIncome = arrytReportResult.value.customerPrice;
      }
      await this.prisma.reports_items.deleteMany({
        where: {
          report_id: reports!.id,
        },
      });

      await this.prisma.reports.update({
        where: {
          id: reports.id,
        },
        data: {
          cash_ids: iikoCachierReport.value.cashIds,
          total_amount: iikoCachierReport.value.totalSum,
          total_manager_price: totalManagerPrice,
          difference,
          arryt_income: arrytIncome,
        },
      });
      const reportItemsData = reportItems.map((item) => ({
        ...item,
        report_id: reports!.id,
        report_date: reports!.date,
      }));
      await this.prisma.reports_items.createMany({
        data: reportItemsData,
      });
    }
  }
}
