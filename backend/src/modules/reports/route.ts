import {
  ReportsCreateArgsSchema,
  ReportsDeleteArgsSchema,
  ReportsFindManyArgsSchema,
  ReportsUpdateArgsSchema,
} from "@backend/lib/zod";
import { getUser, publicProcedure, publicRouter } from "@backend/trpc";
import { ReportsFindUniqueForTerminal } from "./dto/one.dto";

export const reportsRouter = publicRouter({
  add: publicProcedure
    .input(ReportsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.create(input);
    }),

  list: publicProcedure
    .use(getUser)
    .input(ReportsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsService.findMany(input, ctx.currentUser!);
    }),

  listByDate: publicProcedure
    .use(getUser)
    .input(ReportsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsService.getReportsByMonth(input, ctx.currentUser!);
    }),

  one: publicProcedure
    .use(getUser)
    .input(ReportsFindUniqueForTerminal)
    .query(({ input, ctx }) => {
      return ctx.reportsService.findOne(input, ctx.currentUser!);
    }),

  renew: publicProcedure
    .input(ReportsUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.update(input);
    }),

  delete: publicProcedure
    .input(ReportsDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.delete(input);
    }),
});
