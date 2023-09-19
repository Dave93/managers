import {
  Api_tokensCreateArgsSchema,
  Api_tokensFindManyArgsSchema,
  Api_tokensFindUniqueArgsSchema,
  Api_tokensUpdateArgsSchema,
} from "@backend/lib/zod";
import { checkPermission, publicProcedure, publicRouter } from "@backend/trpc";

export const apiTokensRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "api_tokens.add",
    })
    .use(checkPermission)
    .input(Api_tokensCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.apiTokensService.create(input);
    }),
  list: publicProcedure
    .meta({
      permission: "api_tokens.list",
    })
    .use(checkPermission)
    .input(Api_tokensFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.apiTokensService.findMany(input);
    }),

  one: publicProcedure
    .meta({
      permission: "api_tokens.one",
    })
    .use(checkPermission)
    .input(Api_tokensFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.apiTokensService.findOne(input);
    }),

  renew: publicProcedure
    .meta({
      permission: "api_tokens.edit",
    })
    .use(checkPermission)
    .input(Api_tokensUpdateArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.apiTokensService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "api_tokens.delete",
    })
    .use(checkPermission)
    .input(Api_tokensFindUniqueArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.apiTokensService.delete(input);
    }),

  cachedApiTokens: publicProcedure
    .meta({
      permission: "api_tokens.list",
    })
    .use(checkPermission)
    .input(Api_tokensFindManyArgsSchema)
    .query(async ({ input, ctx }) => {
      return await ctx.apiTokensService.cachedApiTokens(input);
    }),
});
