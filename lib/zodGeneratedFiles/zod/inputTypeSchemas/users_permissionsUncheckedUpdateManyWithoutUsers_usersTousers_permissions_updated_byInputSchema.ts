import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { StringFieldUpdateOperationsInputSchema } from './StringFieldUpdateOperationsInputSchema';
import { NullableStringFieldUpdateOperationsInputSchema } from './NullableStringFieldUpdateOperationsInputSchema';

export const users_permissionsUncheckedUpdateManyWithoutUsers_usersTousers_permissions_updated_byInputSchema: z.ZodType<Prisma.users_permissionsUncheckedUpdateManyWithoutUsers_usersTousers_permissions_updated_byInput> = z.object({
  user_id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  permission_id: z.union([ z.string(),z.lazy(() => StringFieldUpdateOperationsInputSchema) ]).optional(),
  created_by: z.union([ z.string(),z.lazy(() => NullableStringFieldUpdateOperationsInputSchema) ]).optional().nullable(),
}).strict();

export default users_permissionsUncheckedUpdateManyWithoutUsers_usersTousers_permissions_updated_byInputSchema;
