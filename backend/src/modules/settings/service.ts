import type { Prisma, Settings } from "@prisma/client";
import { z } from "zod";

import {
  SettingsFindManyArgsSchema,
  SettingsFindUniqueArgsSchema,
} from "@backend/lib/zod";
import { PaginationType } from "@backend/lib/pagination_interface";
import { CacheControlService } from "../cache_control/service";
import { DB } from "@backend/db";

export class SettingsService {
  constructor(
    private readonly prisma: DB,
    private readonly cacheControl: CacheControlService
  ) {}

  async create(input: Prisma.SettingsCreateArgs): Promise<Settings> {
    const res = await this.prisma.settings.create(input);
    await this.cacheControl.cacheSettings();
    return res;
  }

  async findMany(
    input: z.infer<typeof SettingsFindManyArgsSchema>
  ): Promise<PaginationType<Settings>> {
    let take = input.take ?? 20;
    let skip = !input.skip ? 1 : Math.round(input.skip / take);
    if (input.skip && input.skip > 0) {
      skip++;
    }
    delete input.take;
    delete input.skip;
    const [permissions, meta] = await this.prisma.settings
      .paginate(input)
      .withPages({
        limit: take,
        page: skip,
        includePageCount: true,
      });

    permissions.forEach((permission) => {
      if (permission.is_secure) {
        permission.value = "";
      }
    });

    return {
      items: permissions,
      meta,
    };
  }

  async findOne(
    input: z.infer<typeof SettingsFindUniqueArgsSchema>
  ): Promise<Settings | null> {
    const permission = await this.prisma.settings.findUnique(input);
    if (permission?.is_secure) {
      permission.value = "";
    }
    return permission;
  }

  async update(input: Prisma.SettingsUpdateArgs): Promise<Settings> {
    const res = await this.prisma.settings.update(input);
    await this.cacheControl.cacheSettings();
    return res;
  }

  async delete(input: Prisma.SettingsDeleteArgs) {
    const res = await this.prisma.settings.delete(input);
    await this.cacheControl.cacheSettings();
    return res;
  }

  async set(input: Prisma.SettingsUpsertArgs): Promise<Settings> {
    const res = await this.prisma.settings.upsert(input);

    await this.cacheControl.cacheSettings();

    return res;
  }
}
