import {
  ReportsFindManyArgsSchema,
  ReportsIncludeSchema,
  ReportsOrderByWithRelationInputSchema,
  ReportsScalarFieldEnumSchema,
  ReportsSelectSchema,
  ReportsWhereInputSchema,
  ReportsWhereUniqueInputSchema,
} from "@backend/lib/zod";
import { z } from "zod";

export const ReportsFindManyForTerminal = z.object({
  select: ReportsSelectSchema.optional(),
  include: ReportsIncludeSchema.optional(),
  where: ReportsWhereInputSchema.optional(),
  orderBy: z
    .union([
      ReportsOrderByWithRelationInputSchema.array(),
      ReportsOrderByWithRelationInputSchema,
    ])
    .optional(),
  cursor: ReportsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: z
    .union([ReportsScalarFieldEnumSchema, ReportsScalarFieldEnumSchema.array()])
    .optional(),
  terminal_id: z.string(),
});
