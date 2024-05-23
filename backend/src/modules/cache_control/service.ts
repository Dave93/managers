import {
  apiTokensWithRelations,
  organizationWithCredentials,
  terminalsWithCredentials,
} from "./dto/cache.dto";
import { DrizzleDB } from "@backend/lib/db";
import { InferSelectModel, eq, getTableColumns } from "drizzle-orm";
import {
  api_tokens,
  corporation_store,
  credentials,
  organization,
  permissions,
  product_groups,
  report_groups,
  reports_status,
  roles,
  roles_permissions,
  scheduled_reports,
  settings,
  users,
  users_stores,
  work_schedules,
} from "@backend/../drizzle/schema";
import { RolesWithRelations } from "../roles/dto/roles.dto";
import { verifyJwt } from "@backend/lib/bcrypt";
import { userById, userFirstRole } from "@backend/lib/prepare_statements";
import Redis from "ioredis";

export class CacheControlService {
  constructor(
    private readonly drizzle: DrizzleDB,
    private readonly redis: Redis
  ) {
    this.cachePermissions();
    this.cacheOrganization();
    this.cacheRoles();
    this.cacheTerminals();
    this.cacheWorkSchedules();
    this.cacheApiTokens();
    this.cacheScheduledReports();
    this.cacheSettings();
    this.cacheCredentials();
    this.cacheReportGroups();
    this.cacheReportStatuses();
    this.cacheStores();
  }

  async cachePermissions() {
    const permissions = await this.drizzle.query.permissions.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}permissions`,
      JSON.stringify(permissions)
    );
  }

  async getCachedPermissions({ take }: { take?: number }) {
    const permissionsList = await this.redis.get(
      `${process.env.PROJECT_PREFIX}permissions`
    );
    let res = JSON.parse(permissionsList ?? "[]") as InferSelectModel<
      typeof permissions
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheOrganization() {
    const organizationList = await this.drizzle.query.organization.findMany();

    const credentialsList = await this.drizzle.query.credentials.findMany({
      where: eq(credentials.model, "organization"),
    });

    const credentialsByOrgId = credentialsList.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, InferSelectModel<typeof credentials>[]>);

    const newOrganizations: organizationWithCredentials[] = [];

    for (const org of organizationList) {
      const credentials = credentialsByOrgId[org.id];
      const newOrg: organizationWithCredentials = {
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

  async getCachedOrganization({ take }: { take?: number }) {
    const organization = await this.redis.get(
      `${process.env.PROJECT_PREFIX}organization`
    );
    let res = JSON.parse(organization ?? "[]") as organizationWithCredentials[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheRoles() {
    const rolesList = await this.drizzle
      .select({
        id: roles.id,
        name: roles.name,
        code: roles.code,
        active: roles.active,
      })
      .from(roles)
      .execute();

    const rolesPermissionsList = await this.drizzle
      .select({
        slug: permissions.slug,
        role_id: roles_permissions.role_id,
      })
      .from(roles_permissions)
      .leftJoin(
        permissions,
        eq(roles_permissions.permission_id, permissions.id)
      )
      .execute();

    const rolesPermissions = rolesPermissionsList.reduce(
      (acc: any, cur: any) => {
        if (!acc[cur.role_id]) {
          acc[cur.role_id] = [];
        }
        acc[cur.role_id].push(cur.slug);
        return acc;
      },
      {}
    );

    const res = rolesList.map((role: any) => {
      return {
        ...role,
        permissions: rolesPermissions[role.id] || [],
      };
    });
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}_roles`,
      JSON.stringify(res)
    );
  }

  async getCachedRoles({ take }: { take?: number }) {
    const rolesList = await this.redis.get(
      `${process.env.PROJECT_PREFIX}_roles`
    );
    let res = JSON.parse(rolesList ?? "[]") as RolesWithRelations[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheTerminals() {
    const terminalsList = await this.drizzle.query.terminals.findMany();

    const credentialsList = await this.drizzle.query.credentials.findMany({
      where: eq(credentials.model, "terminals"),
    });

    const credentialsByTerminalId = credentialsList.reduce(
      (acc, credential) => {
        if (!acc[credential.model_id]) {
          acc[credential.model_id] = [];
        }
        acc[credential.model_id].push(credential);
        return acc;
      },
      {} as Record<string, InferSelectModel<typeof credentials>[]>
    );

    const newTerminals: terminalsWithCredentials[] = [];

    for (const terminal of terminalsList) {
      const credentials = credentialsByTerminalId[terminal.id];
      const newTerminal: terminalsWithCredentials = {
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

  async getCachedTerminals({ take }: { take?: number }) {
    const terminals = await this.redis.get(
      `${process.env.PROJECT_PREFIX}terminals`
    );
    let res = JSON.parse(terminals ?? "[]") as terminalsWithCredentials[];

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
    return role.permissions;
  }

  async cacheWorkSchedules() {
    const workSchedules = await this.drizzle.query.work_schedules.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}work_schedules`,
      JSON.stringify(workSchedules)
    );
  }

  async getCachedWorkSchedules({ take }: { take?: number }) {
    const workSchedules = await this.redis.get(
      `${process.env.PROJECT_PREFIX}work_schedules`
    );
    let res = JSON.parse(workSchedules ?? "[]") as InferSelectModel<
      typeof work_schedules
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheApiTokens() {
    const apiTokens = await this.drizzle
      .select({
        ...getTableColumns(api_tokens),
        organization: {
          ...getTableColumns(organization),
        },
      })
      .from(api_tokens)
      .leftJoin(organization, eq(api_tokens.organization_id, organization.id))
      .execute();

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}api_tokens`,
      JSON.stringify(apiTokens)
    );
  }

  async getCachedApiTokens({ take }: { take?: number }) {
    const apiTokens = await this.redis.get(
      `${process.env.PROJECT_PREFIX}api_tokens`
    );
    let res = JSON.parse(apiTokens ?? "[]") as apiTokensWithRelations[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheScheduledReports() {
    const scheduledReports =
      await this.drizzle.query.scheduled_reports.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}scheduled_reports`,
      JSON.stringify(scheduledReports)
    );
  }

  async getCachedScheduledReports({ take }: { take?: number }) {
    const scheduledReports = await this.redis.get(
      `${process.env.PROJECT_PREFIX}scheduled_reports`
    );
    let res = JSON.parse(scheduledReports ?? "[]") as InferSelectModel<
      typeof scheduled_reports
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheSettings() {
    const settingsList = await this.drizzle.query.settings.findMany({});
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}settings`,
      JSON.stringify(settingsList)
    );
  }

  async getCachedSettings({ take }: { take?: number }) {
    const settingsList = await this.redis.get(
      `${process.env.PROJECT_PREFIX}settings`
    );
    let res = JSON.parse(settingsList ?? "[]") as InferSelectModel<
      typeof settings
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheCredentials() {
    const credentials = await this.drizzle.query.credentials.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}credentials`,
      JSON.stringify(credentials)
    );
  }

  async getCachedCredentials({ take }: { take?: number }) {
    const credentialsList = await this.redis.get(
      `${process.env.PROJECT_PREFIX}credentials`
    );
    let res = JSON.parse(credentialsList ?? "[]") as InferSelectModel<
      typeof credentials
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheReportGroups() {
    const reportGroups = await this.drizzle.query.report_groups.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}report_groups`,
      JSON.stringify(reportGroups)
    );
  }

  async getCachedReportGroups({ take }: { take?: number }) {
    const reportGroups = await this.redis.get(
      `${process.env.PROJECT_PREFIX}report_groups`
    );
    let res = JSON.parse(reportGroups ?? "[]") as InferSelectModel<
      typeof report_groups
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheReportStatuses() {
    const reportStatuses = await this.drizzle.query.reports_status.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}report_statuses`,
      JSON.stringify(reportStatuses)
    );
  }

  async getCachedReportStatuses({ take }: { take?: number }) {
    const reportStatuses = await this.redis.get(
      `${process.env.PROJECT_PREFIX}report_statuses`
    );

    let res = JSON.parse(reportStatuses ?? "[]") as InferSelectModel<
      typeof reports_status
    >[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }

    return res;
  }

  async cacheUserDataByToken(
    accessToken: string,
    refreshToken: string,
    userId: any
  ) {
    const foundUser = (await userById.execute({
      id: userId,
    })) as InferSelectModel<typeof users>;
    if (!foundUser) {
      return null;
    }

    if (foundUser.status != "active") {
      return null;
    }

    const userRole = await userFirstRole.execute({ user_id: foundUser.id });

    // getting rights
    let permissions: string[] = [];
    if (userRole) {
      permissions = await this.getPermissionsByRoleId(userRole.role_id);
    }
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}user_data:${accessToken}`,
      JSON.stringify({
        user: foundUser,
        accessToken,
        refreshToken,
        permissions: permissions,
        role: {
          id: userRole?.role_id,
          code: userRole?.role?.code,
        },
      })
    );

    return {
      user: foundUser,
      accessToken,
      refreshToken,
      permissions: permissions,
      role: {
        id: userRole?.role_id,
        code: userRole?.role?.code,
      },
    };
  }

  async deleteUserDataByToken(accessToken: string) {
    try {
      await this.redis.del(
        `${process.env.PROJECT_PREFIX}user_data:${accessToken}`
      );
    } catch (e) { }
  }

  async getCachedUserDataByToken(accessToken: string): Promise<{
    user: InferSelectModel<typeof users>;
    accessToken: string;
    refreshToken: string;
    permissions: string[];
  } | null> {
    try {
      let jwtResult = await verifyJwt(accessToken);
      if (!jwtResult.payload.id) {
        return null;
      }
      const data = await this.redis.get(
        `${process.env.PROJECT_PREFIX}user_data:${accessToken}`
      );
      if (data) {
        return JSON.parse(data);
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  }

  async cacheStores() {
    const stores = await this.drizzle.query.corporation_store.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}stores`,
      JSON.stringify(stores)
    );
  }

  async getCachedStores({ take }: { take?: number }) {
    const stores = (await this.redis.get(
      `${process.env.PROJECT_PREFIX}stores`
    )) as string | null;

    if (stores) {
      const storesJson = JSON.parse(stores);
      return storesJson.slice(0, take) as InferSelectModel<
        typeof corporation_store
      >[];
    } else {
      return [];
    }
  }

  async cacheProductGroups() {
    const productGroups = await this.drizzle.query.product_groups.findMany();
    await this.redis.set(
      `${process.env.PROJECT_PREFIX}product_groups`,
      JSON.stringify(productGroups)
    );
  }

  async getCachedProductGroups({ take }: { take?: number }) {
    const productGroups = (await this.redis.get(
      `${process.env.PROJECT_PREFIX}product_groups`
    )) as string | null;

    if (productGroups) {
      const productGroupsJson = JSON.parse(productGroups);
      return productGroupsJson.slice(0, take) as InferSelectModel<
        typeof product_groups
      >[];
    } else {
      return [];
    }
  }
}
