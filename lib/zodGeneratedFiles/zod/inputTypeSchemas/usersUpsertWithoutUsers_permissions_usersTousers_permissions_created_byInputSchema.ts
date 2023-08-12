import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { usersUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema } from './usersUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema';
import { usersUncheckedUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema } from './usersUncheckedUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema';
import { usersCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema } from './usersCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema';
import { usersUncheckedCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema } from './usersUncheckedCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema';
import { usersWhereInputSchema } from './usersWhereInputSchema';

export const usersUpsertWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema: z.ZodType<Prisma.usersUpsertWithoutUsers_permissions_usersTousers_permissions_created_byInput> = z.object({
  update: z.union([ z.lazy(() => usersUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema),z.lazy(() => usersUncheckedUpdateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema) ]),
  create: z.union([ z.lazy(() => usersCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema),z.lazy(() => usersUncheckedCreateWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema) ]),
  where: z.lazy(() => usersWhereInputSchema).optional()
}).strict();

export default usersUpsertWithoutUsers_permissions_usersTousers_permissions_created_byInputSchema;
