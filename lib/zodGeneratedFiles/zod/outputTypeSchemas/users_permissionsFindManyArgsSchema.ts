import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { users_permissionsIncludeSchema } from '../inputTypeSchemas/users_permissionsIncludeSchema'
import { users_permissionsWhereInputSchema } from '../inputTypeSchemas/users_permissionsWhereInputSchema'
import { users_permissionsOrderByWithRelationInputSchema } from '../inputTypeSchemas/users_permissionsOrderByWithRelationInputSchema'
import { users_permissionsWhereUniqueInputSchema } from '../inputTypeSchemas/users_permissionsWhereUniqueInputSchema'
import { Users_permissionsScalarFieldEnumSchema } from '../inputTypeSchemas/Users_permissionsScalarFieldEnumSchema'
import { usersArgsSchema } from "../outputTypeSchemas/usersArgsSchema"
import { permissionsArgsSchema } from "../outputTypeSchemas/permissionsArgsSchema"
// Select schema needs to be in file to prevent circular imports
//------------------------------------------------------

export const users_permissionsSelectSchema: z.ZodType<Prisma.users_permissionsSelect> = z.object({
  user_id: z.boolean().optional(),
  permission_id: z.boolean().optional(),
  created_by: z.boolean().optional(),
  updated_by: z.boolean().optional(),
  users_usersTousers_permissions_created_by: z.union([z.boolean(),z.lazy(() => usersArgsSchema)]).optional(),
  permissions: z.union([z.boolean(),z.lazy(() => permissionsArgsSchema)]).optional(),
  users_usersTousers_permissions_updated_by: z.union([z.boolean(),z.lazy(() => usersArgsSchema)]).optional(),
  users_usersTousers_permissions_user_id: z.union([z.boolean(),z.lazy(() => usersArgsSchema)]).optional(),
}).strict()

export const users_permissionsFindManyArgsSchema: z.ZodType<Prisma.users_permissionsFindManyArgs> = z.object({
  select: users_permissionsSelectSchema.optional(),
  include: users_permissionsIncludeSchema.optional(),
  where: users_permissionsWhereInputSchema.optional(),
  orderBy: z.union([ users_permissionsOrderByWithRelationInputSchema.array(),users_permissionsOrderByWithRelationInputSchema ]).optional(),
  cursor: users_permissionsWhereUniqueInputSchema.optional(),
  take: z.number().optional(),
  skip: z.number().optional(),
  distinct: z.union([ Users_permissionsScalarFieldEnumSchema,Users_permissionsScalarFieldEnumSchema.array() ]).optional(),
}).strict()

export default users_permissionsFindManyArgsSchema;
