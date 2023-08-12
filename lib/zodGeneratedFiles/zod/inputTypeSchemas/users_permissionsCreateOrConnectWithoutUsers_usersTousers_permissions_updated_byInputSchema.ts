import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { users_permissionsWhereUniqueInputSchema } from './users_permissionsWhereUniqueInputSchema';
import { users_permissionsCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema } from './users_permissionsCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema';
import { users_permissionsUncheckedCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema } from './users_permissionsUncheckedCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema';

export const users_permissionsCreateOrConnectWithoutUsers_usersTousers_permissions_updated_byInputSchema: z.ZodType<Prisma.users_permissionsCreateOrConnectWithoutUsers_usersTousers_permissions_updated_byInput> = z.object({
  where: z.lazy(() => users_permissionsWhereUniqueInputSchema),
  create: z.union([ z.lazy(() => users_permissionsCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema),z.lazy(() => users_permissionsUncheckedCreateWithoutUsers_usersTousers_permissions_updated_byInputSchema) ]),
}).strict();

export default users_permissionsCreateOrConnectWithoutUsers_usersTousers_permissions_updated_byInputSchema;
