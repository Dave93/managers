import { DB } from "@backend/db";
import { PaginationType } from "@backend/lib/pagination_interface";
import { Reports, UsersWithRelations } from "@backend/lib/zod";
import { Prisma, Users } from "@prisma/client";
import { z } from "zod";
import { ReportsFindManyForTerminal } from "./dto/list.dto";
import { TRPCError } from "@trpc/server";
import { ReportsFindUniqueForTerminal } from "./dto/one.dto";

export class ReportsService {
  constructor(private readonly prisma: DB) {}

  async create(input: Prisma.ReportsCreateArgs): Promise<Reports> {
    return this.prisma.reports.create(input);
  }

  async findMany(
    input: z.infer<typeof ReportsFindManyForTerminal>,
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

    const chosenTerminal = terminals.find(
      (terminal) => terminal.terminal_id === input.terminal_id
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
}
