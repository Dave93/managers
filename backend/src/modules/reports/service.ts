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

export class ReportsService {
  constructor(private readonly prisma: DB) {}

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
    input: z.infer<typeof ReportsFindManyArgsSchema>,
    currentUser: Omit<UsersWithRelations, "password">
  ): Promise<ReportsWithRelations[] | null> {
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

    const reports = await this.prisma.reports.findFirst({
      where: {
        terminal_id: input.where?.terminal_id,
        date: input.where?.date,
      },
    });
    if (!reports) {
    }
  }
}
