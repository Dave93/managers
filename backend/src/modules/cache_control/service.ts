import { DB, RedisClientType } from "@backend/trpc";
import { organization, permissions, roles } from "@prisma/client";

export class CacheControlService {
  constructor(
    private readonly prisma: DB,
    private readonly redis: RedisClientType
  ) {
    this.cachePermissions();
    this.cacheOrganization();
  }

  async cachePermissions() {
    const permissions = await this.prisma.permissions.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}permissions`,
      JSON.stringify(permissions)
    );
  }

  async getCachedPermissions({
    take,
  }: {
    take?: number;
  }): Promise<permissions[]> {
    const permissions = await this.redis.get(
      `${process.env.PROJECT_PREFIX}permissions`
    );
    let res = JSON.parse(permissions ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheOrganization() {
    const organization = await this.prisma.organization.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}organization`,
      JSON.stringify(organization)
    );
  }

  async getCachedOrganization({
    take,
  }: {
    take?: number;
  }): Promise<organization[]> {
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
    const roles = await this.prisma.roles.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}roles`,
      JSON.stringify(roles)
    );
  }

  async getCachedRoles({ take }: { take?: number }): Promise<roles[]> {
    const roles = await this.redis.get(`${process.env.PROJECT_PREFIX}roles`);
    let res = JSON.parse(roles ?? "[]");

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }
}
