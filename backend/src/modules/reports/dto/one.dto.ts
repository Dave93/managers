import { z } from "zod";
import Prisma from "@prisma/client";
import {
  ReportsIncludeSchema,
  ReportsSelectSchema,
  ReportsWhereUniqueInputSchema,
} from "@backend/lib/zod";

export const ReportsFindUniqueForTerminal = z
  .object({
    select: ReportsSelectSchema.optional(),
    include: ReportsIncludeSchema.optional(),
    where: ReportsWhereUniqueInputSchema,
    terminal_id: z.string(),
  })
  .strict();
