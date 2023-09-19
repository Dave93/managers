import {
  ReportsCreateArgsSchema,
  ReportsDeleteArgsSchema,
  ReportsFindManyArgsSchema,
  ReportsUpdateArgsSchema,
} from "@backend/lib/zod";
import {
  checkPermission,
  getUser,
  publicProcedure,
  publicRouter,
} from "@backend/trpc";
import { ReportsFindUniqueForTerminal } from "./dto/one.dto";
import {
  UniqueReportsByDayInputSchema,
  UniqueSetReportDataInputSchema,
} from "@backend/lib/z_objects";

export const reportsRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "reports.add",
    })
    .use(checkPermission)
    .input(ReportsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "reports.list",
    })
    .use(checkPermission)
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
    .meta({
      permission: "reports.one",
    })
    .use(checkPermission)
    .input(ReportsFindUniqueForTerminal)
    .query(({ input, ctx }) => {
      return ctx.reportsService.findOne(input, ctx.currentUser!);
    }),

  renew: publicProcedure
    .meta({
      permission: "reports.edit",
    })
    .use(checkPermission)
    .input(ReportsUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "reports.delete",
    })
    .use(checkPermission)
    .input(ReportsDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.delete(input);
    }),

  getUniqueReportsByDay: publicProcedure
    .use(getUser)
    .input(UniqueReportsByDayInputSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsService.getUniqueReportsByDay(input, ctx.currentUser!);
    }),

  setReportData: publicProcedure
    .use(getUser)
    .input(UniqueSetReportDataInputSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsService.setReportData(input, ctx.currentUser!);
    }),
});
