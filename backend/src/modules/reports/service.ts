import { DB } from "@backend/db";
import { PaginationType } from "@backend/lib/pagination_interface";
import {
  Reports,
  ReportsFindManyArgsSchema,
  ReportsWithRelations,
  UsersWithRelations,
} from "@backend/lib/zod";
import { Prisma, Users } from "@prisma/client";
import { date, z } from "zod";
import { TRPCError } from "@trpc/server";
import { ReportsFindUniqueForTerminal } from "./dto/one.dto";
import dayjs from "dayjs";
import { merchantTrpcClient } from "@backend/lib/merchant-trpc-server";
import { CacheControlService } from "../cache_control/service";
import { UniqueReportsByDayInputSchema } from "@backend/lib/z_objects";

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
  ): Promise<PaginationType<Reports>> {
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
      items: reports,
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
  ): Promise<
    | {
        type: string;
        error: any;
        data: any;
      }[]
    | null
  > {
    const result = [];
    const terminals = await this.prisma.users_terminals.findMany({
      where: {
        user_id: currentUser.id,
      },
      select: {
        terminal_id: true,
        terminals: {
          select: {
            organization_id: true,
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

    const reports = await this.prisma.reports.findFirst({
      where: {
        terminal_id: input.terminal_id,
        date: dayjs.unix(+input.date).hour(0).minute(0).second(0).toDate(),
      },
    });
    if (!reports) {
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

      const organizations = await this.cacheControl.getCachedOrganization({});
      const organization = organizations.find(
        (org) => org.id === chosenTerminal?.terminals?.organization_id
      );

      let date = input.date;

      if (!date) {
        date = dayjs().toISOString();
      }

      date = dayjs.unix(+input.date).toISOString();
      console.log("report date send", date);
      const [clickReportResult, paymeReportResult] = await Promise.allSettled([
        merchantTrpcClient.getClickReport.query({
          serviceIds: clickServiceIds?.split(",") ?? [],
          date,
        }),
        merchantTrpcClient.getPaymeReport.query({
          businessId: paymeBusinessId ?? "",
          serviceIds: paymeMerchantIds?.split(",") ?? [],
          date,
        }),
      ]);

      if (clickReportResult.status == "rejected") {
        result.push({
          data: null,
          error: clickReportResult.reason,
          type: "click",
        });
      } else {
        result.push({
          error: null,
          data: clickReportResult.value,
          type: "click",
        });
      }

      if (paymeReportResult.status == "rejected") {
        result.push({
          error: paymeReportResult.reason,
          data: null,
          type: "payme",
        });
      } else {
        result.push({
          error: null,
          data: paymeReportResult.value,
          type: "payme",
        });
      }
    }
    return result;
  }
}
