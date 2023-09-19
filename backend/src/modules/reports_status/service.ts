import { DB } from "@backend/db";
import { PaginationType } from "@backend/lib/pagination_interface";
import {
  Reports_status,
  Reports_statusFindManyArgsSchema,
  Reports_statusFindUniqueArgsSchema,
} from "@backend/lib/zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { CacheControlService } from "../cache_control/service";

export class ReportsStatusService {
  constructor(
    private readonly prisma: DB,
    private readonly cacheControl: CacheControlService
  ) {}

  async create(
    input: Prisma.Reports_statusCreateArgs
  ): Promise<Reports_status> {
    const res = await this.prisma.reports_status.create(input);
    await this.cacheControl.cacheReportStatuses();

    return res;
  }

  async findMany(
    input: z.infer<typeof Reports_statusFindManyArgsSchema>
  ): Promise<PaginationType<Reports_status>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;
    const [reports_status, meta] = await this.prisma.reports_status
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });
    return {
      items: reports_status,
      meta,
    };
  }

  async findUnique(
    input: z.infer<typeof Reports_statusFindUniqueArgsSchema>
  ): Promise<Reports_status | null> {
    return this.prisma.reports_status.findUnique(input);
  }

  async update(
    input: Prisma.Reports_statusUpdateArgs
  ): Promise<Reports_status> {
    const res = await this.prisma.reports_status.update(input);
    await this.cacheControl.cacheReportStatuses();

    return res;
  }

  async delete(input: Prisma.Reports_statusDeleteArgs) {
    const res = await this.prisma.reports_status.delete(input);
    await this.cacheControl.cacheReportStatuses();

    return res;
  }

  async cachedReportsStatus(
    input: z.infer<typeof Reports_statusFindManyArgsSchema>
  ): Promise<Reports_status[]> {
    return this.prisma.reports_status.findMany(input);
  }
}
