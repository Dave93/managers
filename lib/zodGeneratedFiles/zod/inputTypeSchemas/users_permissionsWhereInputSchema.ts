import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { UuidFilterSchema } from './UuidFilterSchema';
import { UuidNullableFilterSchema } from './UuidNullableFilterSchema';
import { UsersNullableRelationFilterSchema } from './UsersNullableRelationFilterSchema';
import { usersWhereInputSchema } from './usersWhereInputSchema';
import { PermissionsRelationFilterSchema } from './PermissionsRelationFilterSchema';
import { permissionsWhereInputSchema } from './permissionsWhereInputSchema';
import { UsersRelationFilterSchema } from './UsersRelationFilterSchema';

export const users_permissionsWhereInputSchema: z.ZodType<Prisma.users_permissionsWhereInput> = z.object({
  AND: z.union([ z.lazy(() => users_permissionsWhereInputSchema),z.lazy(() => users_permissionsWhereInputSchema).array() ]).optional(),
  OR: z.lazy(() => users_permissionsWhereInputSchema).array().optional(),
  NOT: z.union([ z.lazy(() => users_permissionsWhereInputSchema),z.lazy(() => users_permissionsWhereInputSchema).array() ]).optional(),
  user_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  permission_id: z.union([ z.lazy(() => UuidFilterSchema),z.string() ]).optional(),
  created_by: z.union([ z.lazy(() => UuidNullableFilterSchema),z.string() ]).optional().nullable(),
  updated_by: z.union([ z.lazy(() => UuidNullableFilterSchema),z.string() ]).optional().nullable(),
  users_usersTousers_permissions_created_by: z.union([ z.lazy(() => UsersNullableRelationFilterSchema),z.lazy(() => usersWhereInputSchema) ]).optional().nullable(),
  permissions: z.union([ z.lazy(() => PermissionsRelationFilterSchema),z.lazy(() => permissionsWhereInputSchema) ]).optional(),
  users_usersTousers_permissions_updated_by: z.union([ z.lazy(() => UsersNullableRelationFilterSchema),z.lazy(() => usersWhereInputSchema) ]).optional().nullable(),
  users_usersTousers_permissions_user_id: z.union([ z.lazy(() => UsersRelationFilterSchema),z.lazy(() => usersWhereInputSchema) ]).optional(),
}).strict();

export default users_permissionsWhereInputSchema;