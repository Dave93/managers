import { DB } from "@backend/db";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  Reports_logs,
  Reports_logsFindManyArgsSchema,
  Reports_logsFindUniqueArgsSchema,
} from "@backend/lib/zod";
import { PaginationType } from "@backend/lib/pagination_interface";

export class ReportsLogs {
  constructor(private readonly prisma: DB) {}
  async create(input: Prisma.Reports_logsCreateArgs): Promise<Reports_logs> {
    const res = await this.prisma.reports_logs.create(input);
    return res;
  }

  async findMany(
    input: z.infer<typeof Reports_logsFindManyArgsSchema>
  ): Promise<PaginationType<Reports_logs>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;
    const [reports_logs, meta] = await this.prisma.reports_logs
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });
    return {
      items: reports_logs,
      meta,
    };
  }

  async findUnique(
    input: z.infer<typeof Reports_logsFindUniqueArgsSchema>
  ): Promise<Reports_logs | null> {
    return this.prisma.reports_logs.findUnique(input);
  }

  async update(input: Prisma.Reports_logsUpdateArgs): Promise<Reports_logs> {
    const res = await this.prisma.reports_logs.update(input);
    return res;
  }

  async delete(input: Prisma.Reports_logsDeleteArgs) {
    const res = await this.prisma.reports_logs.delete(input);
    return res;
  }
}
