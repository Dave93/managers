import { checkPermission, publicProcedure, publicRouter } from "@backend/trpc";
import {
  Reports_itemsCreateArgsSchema,
  Reports_itemsDeleteArgsSchema,
  Reports_itemsFindManyArgsSchema,
  Reports_itemsFindUniqueArgsSchema,
  Reports_itemsUpdateArgsSchema,
} from "@backend/lib/zod";

export const ReportsItemsRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "reports_items.add",
    })
    .use(checkPermission)
    .input(Reports_itemsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsItemsService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "reports_items.list",
    })
    .use(checkPermission)
    .input(Reports_itemsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsItemsService.findMany(input);
    }),

  one: publicProcedure
    .meta({
      permission: "reports_items.one",
    })
    .use(checkPermission)
    .input(Reports_itemsFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.reportsItemsService.findUnique(input);
    }),

  renew: publicProcedure
    .meta({
      permission: "reports_items.edit",
    })
    .use(checkPermission)
    .input(Reports_itemsUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsItemsService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "reports_items.delete",
    })
    .use(checkPermission)
    .input(Reports_itemsDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.reportsItemsService.delete(input);
    }),
});
