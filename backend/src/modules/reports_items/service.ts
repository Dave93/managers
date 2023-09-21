import { DB } from "@backend/db";
import { PaginationType } from "@backend/lib/pagination_interface";
import {
  Reports_items,
  Reports_itemsFindManyArgsSchema,
  Reports_itemsFindUniqueArgsSchema,
  Reports_itemsWithRelations,
} from "@backend/lib/zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export class ReportsItemsService {
  constructor(private readonly prisma: DB) {}

  async create(input: Prisma.Reports_itemsCreateArgs): Promise<Reports_items> {
    const res = await this.prisma.reports_items.create(input);
    return res;
  }

  async findMany(
    input: z.infer<typeof Reports_itemsFindManyArgsSchema>
  ): Promise<PaginationType<Reports_itemsWithRelations>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;
    const [reports_status, meta] = await this.prisma.reports_items
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });
    return {
      items: reports_status as Reports_itemsWithRelations[],
      meta,
    };
  }

  async findUnique(
    input: z.infer<typeof Reports_itemsFindUniqueArgsSchema>
  ): Promise<Reports_items | null> {
    return this.prisma.reports_items.findUnique(input);
  }

  async update(input: Prisma.Reports_itemsUpdateArgs): Promise<Reports_items> {
    const res = await this.prisma.reports_items.update(input);

    const reportItems = await this.prisma.reports_items.findMany({
      where: {
        report_id: res.report_id,
      },
      select: {
        amount: true,
      },
    });

    const totalManagerPrice = reportItems.reduce((acc, item) => {
      return acc + item.amount;
    }, 0);

    const report = await this.prisma.reports.findUnique({
      where: {
        id: res.report_id,
      },
      select: {
        total_amount: true,
      },
    });

    let difference = 0;
    if (report?.total_amount) {
      difference = totalManagerPrice - report?.total_amount;
    }
    await this.prisma.reports.update({
      where: {
        id: res.report_id,
      },
      data: {
        total_manager_price: totalManagerPrice,
        difference,
      },
    });

    return res;
  }

  async delete(input: Prisma.Reports_itemsDeleteArgs) {
    const res = await this.prisma.reports_items.delete(input);

    return res;
  }
}
