import { publicRouter, publicProcedure, checkPermission } from "@backend/trpc";
import {
  TerminalsCreateArgsSchema,
  TerminalsDeleteArgsSchema,
  TerminalsFindManyArgsSchema,
  TerminalsFindUniqueArgsSchema,
  TerminalsUpdateArgsSchema,
} from "@backend/lib/zod";

export const terminalsRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "terminals.add",
    })
    .use(checkPermission)
    .input(TerminalsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.terminalsService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "terminals.list",
    })
    .use(checkPermission)
    .input(TerminalsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.terminalsService.findMany(input);
    }),

  one: publicProcedure
    .meta({
      permission: "terminals.one",
    })
    .use(checkPermission)
    .input(TerminalsFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.terminalsService.findOne(input);
    }),

  renew: publicProcedure
    .meta({
      permission: "terminals.edit",
    })
    .use(checkPermission)
    .input(TerminalsUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.terminalsService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "terminals.delete",
    })
    .use(checkPermission)
    .input(TerminalsDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.terminalsService.delete(input);
    }),

  cachedTerminals: publicProcedure
    .meta({
      permission: "terminals.list",
    })
    .use(checkPermission)
    .input(TerminalsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.terminalsService.cachedTerminals(input);
    }),
});
