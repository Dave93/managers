import {
  OrganizationCreateArgsSchema,
  OrganizationUpdateArgsSchema,
  OrganizationFindUniqueArgsSchema,
  OrganizationFindManyArgsSchema,
  OrganizationDeleteArgsSchema,
} from "@backend/lib/zod";
import { checkPermission, publicProcedure, publicRouter } from "@backend/trpc";

export const organizationRouter = publicRouter({
  add: publicProcedure
    .meta({
      permission: "organizations.add",
    })
    .use(checkPermission)
    .input(OrganizationCreateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.organizationService.create(input);
    }),

  list: publicProcedure
    .meta({
      permission: "organizations.list",
    })
    .use(checkPermission)
    .input(OrganizationFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.organizationService.findMany(input);
    }),

  one: publicProcedure
    .meta({
      permission: "organizations.one",
    })
    .use(checkPermission)
    .input(OrganizationFindUniqueArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.organizationService.findOne(input);
    }),

  renew: publicProcedure
    .meta({
      permission: "organizations.edit",
    })
    .use(checkPermission)
    .input(OrganizationUpdateArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.organizationService.update(input);
    }),

  delete: publicProcedure
    .meta({
      permission: "organizations.delete",
    })
    .use(checkPermission)
    .input(OrganizationDeleteArgsSchema)
    .mutation(({ input, ctx }) => {
      return ctx.organizationService.delete(input);
    }),

  cachedOrganizations: publicProcedure
    .input(OrganizationFindManyArgsSchema)
    .query(({ input, ctx }) => {
      return ctx.organizationService.cachedOrginization(input);
    }),
});
