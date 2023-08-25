import {
  CredentialsCreateArgsSchema,
  CredentialsFindManyArgsSchema,
  CredentialsFindUniqueArgsSchema,
  CredentialsUpdateArgsSchema,
} from "@backend/lib/zod";
import { checkPermission, publicProcedure, publicRouter } from "@backend/trpc";

export const credentialsRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "credentials.add",
    })
    .use(checkPermission)
    .input(CredentialsCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.credentialsService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "credentials.list",
    })
    .use(checkPermission)
    .input(CredentialsFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.credentialsService.findMany(input);
    }),

  one: publicProcedure
    .meta({
      permission: "credentials.one",
    })
    .use(checkPermission)
    .input(CredentialsFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.credentialsService.findOne(input);
    }),

  renew: publicProcedure
    .meta({
      permission: "credentials.edit",
    })
    .use(checkPermission)
    .input(CredentialsUpdateArgsSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.credentialsService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "credentials.delete",
    })
    .use(checkPermission)
    .input(CredentialsFindUniqueArgsSchema)
    .mutation(async ({ input, ctx }) => {
      return await ctx.credentialsService.delete(input);
    }),

  cachedCredentials: publicProcedure
    .input(CredentialsFindManyArgsSchema)
    .query(async ({ input, ctx }) => {
      return await ctx.credentialsService.cachedCredentials(input);
    }),
});
