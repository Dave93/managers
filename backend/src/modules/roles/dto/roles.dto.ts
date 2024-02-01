import { paginatedZodObj } from "@backend/lib/z_objects";
import { roles } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { z } from "zod";

export type rolesCreateInput = {
  id?: string;
  name: string;
  code?: string;
  active?: boolean;
  created_at?: Date | string;
  updated_at?: Date | string;
};

export const rolesFindManyZod = paginatedZodObj.extend({
  where: z
    .object({
      name: z.string().optional(),
      code: z.string().optional(),
      active: z.boolean().optional(),
      created_at: z.date().optional(),
    })
    .optional(),
});


export type RolesWithRelations = InferSelectModel<typeof roles> & {
  permissions: string[];
};