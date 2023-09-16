import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  CredentialsFindManyArgsSchema,
  CredentialsFindUniqueArgsSchema,
  Credentials,
} from "@backend/lib/zod";
import { PaginationType } from "@backend/lib/pagination_interface";
import { CacheControlService } from "../cache_control/service";
import { DB } from "@backend/db";

export class CredentialsService {
  constructor(
    private readonly prisma: DB,
    private readonly cacheControl: CacheControlService
  ) {}

  async create(input: Prisma.CredentialsCreateArgs): Promise<Credentials> {
    const res = await this.prisma.credentials.create(input);
    await this.cacheControl.cacheCredentials();
    return res;
  }

  async findMany(
    input: z.infer<typeof CredentialsFindManyArgsSchema>
  ): Promise<PaginationType<Credentials>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;
    const [permissions, meta] = await this.prisma.credentials
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });

    return {
      items: permissions,
      meta,
    };
  }

  async findOne(
    input: z.infer<typeof CredentialsFindUniqueArgsSchema>
  ): Promise<Credentials | null> {
    const permission = await this.prisma.credentials.findUnique(input);
    return permission;
  }

  async update(input: Prisma.CredentialsUpdateArgs): Promise<Credentials> {
    const res = await this.prisma.credentials.update(input);
    await this.cacheControl.cacheCredentials();
    return res;
  }

  async delete(input: Prisma.CredentialsDeleteArgs) {
    const res = await this.prisma.credentials.delete(input);
    await this.cacheControl.cacheCredentials();
    return res;
  }

  // async cachedPermissions(
  //   input: z.infer<typeof CredentialsFindManyArgsSchema>
  // ): Promise<Credentials[]> {
  //   return await this.cacheControl.getCachedPermissions(input);
  // }

  cachedCredentials(input: Prisma.CredentialsFindManyArgs): any {
    throw new Error("Method not implemented.");
  }
}
