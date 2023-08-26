import { DB } from "@backend/db";
import {
  Terminals,
  RolesWithRelations,
  Organization,
  Permissions,
  Work_schedules,
  Api_tokens,
  Scheduled_reports,
  Credentials,
} from "@backend/lib/zod";
import { RedisClientType } from "@backend/trpc";
import { ISortedItemRepository, SortedItemRepository } from "item-store-redis";
import {
  OrganizationWithCredentials,
  TerminalsWithCredentials,
} from "./dto/cache.dto";
import { z } from "zod";

export class CacheControlService {
  private sortedItemRepository: ISortedItemRepository<Permissions>;

  constructor(
    private readonly prisma: DB,
    private readonly redis: RedisClientType
  ) {
    this.sortedItemRepository = new SortedItemRepository<Permissions>(
      `${process.env.PROJECT_PREFIX}permissions_paginated`,
      redis
    );

    this.cachePermissions();
    this.cacheOrganization();
    this.cacheRoles();
    this.cacheTerminals();
    this.chacheWorkSchedules();
  }

  async cachePermissions() {
    const permissions = await this.prisma.permissions.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}permissions`,
      JSON.stringify(permissions)
    );

    for (const permission of permissions) {
      await this.sortedItemRepository.set({
        id: permission.id,
        data: permission,
      });
    }
    // await this.sortedItemRepository.set(permissions);
  }

  async getCachedPermissions({
    take,
  }: {
    take?: number;
  }): Promise<Permissions[]> {
    const permissions = await this.redis.get(
      `${process.env.PROJECT_PREFIX}permissions`
    );
    let res = JSON.parse(permissions ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async getPaginatedCachedPermissions({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
  }): Promise<Permissions[]> {
    const res = await this.sortedItemRepository.getPaginated(page, pageSize);
    return res.items.map((item) => item.data);
  }

  async cacheOrganization() {
    const organization = await this.prisma.organization.findMany();

    const credentials = await this.prisma.credentials.findMany({
      where: {
        model: "organization",
      },
    });

    const credentialsByOrgId = credentials.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, Credentials[]>);

    const newOrganizations: z.infer<typeof OrganizationWithCredentials>[] = [];

    for (const org of organization) {
      const credentials = credentialsByOrgId[org.id];
      const newOrg: z.infer<typeof OrganizationWithCredentials> = {
        ...org,
        credentials: [],
      };
      if (credentials) {
        newOrg.credentials = credentials;
      }
      newOrganizations.push(newOrg);
    }

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}organization`,
      JSON.stringify(newOrganizations)
    );
  }

  async getCachedOrganization({
    take,
  }: {
    take?: number;
  }): Promise<Organization[]> {
    const organization = await this.redis.get(
      `${process.env.PROJECT_PREFIX}organization`
    );
    let res = JSON.parse(organization ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheRoles() {
    const roles = await this.prisma.roles.findMany({
      include: {
        roles_permissions: {
          include: {
            permissions: true,
          },
          take: 1000,
        },
      },
    });

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}roles`,
      JSON.stringify(roles)
    );
  }

  async getCachedRoles({
    take,
  }: {
    take?: number;
  }): Promise<RolesWithRelations[]> {
    const roles = await this.redis.get(`${process.env.PROJECT_PREFIX}roles`);
    let res = JSON.parse(roles ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheTerminals() {
    const terminals = await this.prisma.terminals.findMany();

    const credentials = await this.prisma.credentials.findMany({
      where: {
        model: "terminals",
      },
    });

    const credentialsByTerminalId = credentials.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, Credentials[]>);

    const newTerminals: z.infer<typeof TerminalsWithCredentials>[] = [];

    for (const terminal of terminals) {
      const credentials = credentialsByTerminalId[terminal.id];
      const newTerminal: z.infer<typeof TerminalsWithCredentials> = {
        ...terminal,
        credentials: [],
      };
      if (credentials) {
        newTerminal.credentials = credentials;
      }
      newTerminals.push(newTerminal);
    }

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}terminals`,
      JSON.stringify(newTerminals)
    );
  }

  async getCachedTerminals({ take }: { take?: number }): Promise<Terminals[]> {
    const terminals = await this.redis.get(
      `${process.env.PROJECT_PREFIX}terminals`
    );
    let res = JSON.parse(terminals ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async getPermissionsByRoleId(roleId: string) {
    if (!roleId) {
      return [];
    }

    const roles = await this.getCachedRoles({});
    // console.log("roles", roles);
    const role = roles.find((role) => role.id === roleId);
    if (!role) {
      return [];
    }
    return role.roles_permissions.map((rolePermission) => {
      return rolePermission.permissions.slug;
    });
  }

  async chacheWorkSchedules() {
    const workSchedules = await this.prisma.work_schedules.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}work_schedules`,
      JSON.stringify(workSchedules)
    );
  }

  async getCachedWorkSchedules({
    take,
  }: {
    take?: number;
  }): Promise<Work_schedules[]> {
    const workSchedules = await this.redis.get(
      `${process.env.PROJECT_PREFIX}work_schedules`
    );
    let res = JSON.parse(workSchedules ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheApiTokens() {
    const apiTokens = await this.prisma.api_tokens.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}api_tokens`,
      JSON.stringify(apiTokens)
    );
  }

  async getCachedApiTokens({ take }: { take?: number }): Promise<Api_tokens[]> {
    const apiTokens = await this.redis.get(
      `${process.env.PROJECT_PREFIX}api_tokens`
    );
    let res = JSON.parse(apiTokens ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheScheduledReports() {
    const scheduledReports = await this.prisma.scheduled_reports.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}scheduled_reports`,
      JSON.stringify(scheduledReports)
    );
  }

  async getCachedScheduledReports({
    take,
  }: {
    take?: number;
  }): Promise<Scheduled_reports[]> {
    const scheduledReports = await this.redis.get(
      `${process.env.PROJECT_PREFIX}scheduled_reports`
    );
    let res = JSON.parse(scheduledReports ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheSettings() {
    const settings = await this.prisma.settings.findMany({
      take: 1000,
    });
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}settings`,
      JSON.stringify(settings)
    );
  }
}
