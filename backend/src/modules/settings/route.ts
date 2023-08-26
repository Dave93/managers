import {
  SettingsCreateArgsSchema,
  SettingsFindManyArgsSchema,
  SettingsFindUniqueArgsSchema,
  SettingsUpdateArgsSchema,
  SettingsUpsertArgsSchema,
} from "@backend/lib/zod";
import { checkPermission, publicProcedure, publicRouter } from "@backend/trpc";

export const settingsRouter = publicRouter({
  add: publicProcedure
    .input(SettingsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.settingsService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "permissions.list",
    })
    .use(checkPermission)
    .input(SettingsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.settingsService.findMany(input);
    }),

  one: publicProcedure
    .input(SettingsFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.settingsService.findOne(input);
    }),

  renew: publicProcedure
    .input(SettingsUpdateArgsSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.settingsService.update(input);
    }),

  delete: publicProcedure
    .input(SettingsFindUniqueArgsSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.settingsService.delete(input);
    }),

  set: publicProcedure
    .input(SettingsUpsertArgsSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.settingsService.set(input);
    }),
});
