import {
  users_roles,
  users_rolesFindManyArgsSchema,
  users_rolesFindUniqueArgsSchema,
  users_rolesWithRelations,
} from "@backend/lib/zod";
import { DB } from "@backend/trpc";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createManyRolesForUserSchema } from "@backend/lib/custom_zod_objects/createManyRolesForUser";

export class UsersRolesService {
  constructor(private readonly prisma: DB) {}

  async create(input: Prisma.users_rolesCreateArgs): Promise<users_roles> {
    return await this.prisma.users_roles.create(input);
  }

  async findMany(
    input: z.infer<typeof users_rolesFindManyArgsSchema>
  ): Promise<users_rolesWithRelations[]> {
    const users_roles = await this.prisma.users_roles.findMany({
      ...input,
      include: {
        roles: true,
      },
    });
    return users_roles as users_rolesWithRelations[];
  }

  async findOne(
    input: z.infer<typeof users_rolesFindUniqueArgsSchema>
  ): Promise<users_roles | null> {
    return await this.prisma.users_roles.findUnique(input);
  }

  async update(input: Prisma.users_rolesUpdateArgs): Promise<users_roles> {
    return await this.prisma.users_roles.update(input);
  }

  async createManyRoles(
    input: z.infer<typeof createManyRolesForUserSchema>
  ): Promise<number> {
    await this.prisma.users_roles.deleteMany({
      where: {
        user_id: input.user_id,
      },
    });

    const res = await this.prisma.users_roles.createMany({
      data: input.roles_ids.map((role_id) => ({
        role_id,
        user_id: input.user_id,
      })),
    });
    return res.count;
  }
}
