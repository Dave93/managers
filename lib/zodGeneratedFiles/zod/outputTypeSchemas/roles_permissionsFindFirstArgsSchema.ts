import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { roles_permissionsIncludeSchema } from '../inputTypeSchemas/roles_permissionsIncludeSchema'
import { roles_permissionsWhereInputSchema } from '../inputTypeSchemas/roles_permissionsWhereInputSchema'
import { roles_permissionsOrderByWithRelationInputSchema } from '../inputTypeSchemas/roles_permissionsOrderByWithRelationInputSchema'
import { roles_permissionsWhereUniqueInputSchema } from '../inputTypeSchemas/roles_permissionsWhereUniqueInputSchema'
import { Roles_permissionsScalarFieldEnumSchema } from '../inputTypeSchemas/Roles_permissionsScalarFieldEnumSchema'
import { usersArgsSchema } from "../outputTypeSchemas/usersArgsSchema"
import { permissionsArgsSchema } from "../outputTypeSchemas/permissionsArgsSchema"
import { rolesArgsSchema } from "../outputTypeSchemas/rolesArgsSchema"
// Select schema needs to be in file to prevent circular imports
//------------------------------------------------------

export const roles_permissionsSelectSchema: z.ZodType<Prisma.roles_permissionsSelect> = z.object({
  role_id: z.boolean().optional(),
  permission_id: z.boolean().optional(),
  created_by: z.boolean().optional(),
  updated_by: z.boolean().optional(),
  users_roles_permissions_created_byTousers: z.union([z.boolean(),z.lazy(() => usersArgsSchema)]).optional(),
  permissions: z.union([z.boolean(),z.lazy(() => permissionsArgsSchema)]).optional(),
  roles: z.union([z.boolean(),z.lazy(() => rolesArgsSchema)]).optional(),
  users_roles_permissions_updated_byTousers: z.union([z.boolean(),z.lazy(() => usersArgsSchema)]).optional(),
}).strict()

export const roles_permissionsFindFirstArgsSchema: z.ZodType<Prisma.roles_permissionsFindFirstArgs> = z.object({
  select: roles_permissionsSelectSchema.optional(),
  include: roles_permissionsIncludeSchema.optional(),
  where: roles_permissionsWhereInputSchema.optional(),
  orderBy: z.union([ roles_permissionsOrderByWithRelationInputSchema.array(),roles_permissionsOrderByWithRelationInputSchema ]).optional(),
  cursor: roles_permissionsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: z.union([ Roles_permissionsScalarFieldEnumSchema,Roles_permissionsScalarFieldEnumSchema.array() ]).optional(),
}).strict()

export default roles_permissionsFindFirstArgsSchema;