import { publicProcedure, publicRouter } from "@backend/trpc";
import {
  Reports_statusCreateArgsSchema,
  Reports_statusDeleteArgsSchema,
  Reports_statusFindManyArgsSchema,
  Reports_statusFindUniqueArgsSchema,
  Reports_statusUpdateArgsSchema,
} from "@backend/lib/zod";

export const ReportsStatusRouter = publicRouter({
  add: publicProcedure
    .input(Reports_statusCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsStatusService.create(input);
    }),

  list: publicProcedure
    .input(Reports_statusFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsStatusService.findMany(input);
    }),

  one: publicProcedure
    .input(Reports_statusFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsStatusService.findUnique(input);
    }),

  renew: publicProcedure
    .input(Reports_statusUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsStatusService.update(input);
    }),

  delete: publicProcedure
    .input(Reports_statusDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsStatusService.delete(input);
    }),
});
