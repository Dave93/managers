// trpc.ts

import { TRPCError, initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import Redis from "ioredis";

import { PermissionsService } from "./modules/permissions/service";
import { RolesService } from "./modules/roles/service";
import { RolesPermissionsService } from "./modules/roles_permissions/service";
import { UsersService } from "./modules/users/service";
import { UsersPermissionsService } from "./modules/users_permissions/service";
import { UsersRolesService } from "./modules/users_roles/service";
import { WorkSchedulesService } from "./modules/work_schedules/service";
import { TerminalsService } from "./modules/terminals/service";
import { OrganizationService } from "./modules/organization/service";
import { UsersTerminalsService } from "./modules/users_terminals/service";
import { CacheControlService } from "./modules/cache_control/service";
import { SessionsService } from "./modules/sessions/service";
import { UsersWorkSchedulesService } from "./modules/users_work_schedules/service";
import { WorkScheduleEntriesService } from "./modules/work_schedule_entries/service";
import { ApiTokensService } from "./modules/api_tokens/service";
import { TimesheetService } from "./modules/timesheet/service";
import { ScheduledReportsService } from "./modules/scheduled_reports/service";
import { db } from "./db";
import { verifyJwt } from "./lib/bcrypt";
import { CredentialsService } from "./modules/credentials/service";
import { SettingsService } from "./modules/settings/service";
import { UsersWithRelations } from "./lib/zod";
import { ReportsService } from "./modules/reports/service";
import { ReportsStatusService } from "./modules/reports_status/service";

const client = new Redis({ host: "localhost", port: 6379 });
export type RedisClientType = typeof client;

const cacheControlService = new CacheControlService(db, client);
const permissionsService = new PermissionsService(db, cacheControlService);
const rolesService = new RolesService(db, cacheControlService);
const rolesPermissionsService = new RolesPermissionsService(
  db,
  cacheControlService
);
const usersService = new UsersService(db, cacheControlService);
const usersPermissionsService = new UsersPermissionsService(db);
const usersRolesService = new UsersRolesService(db);
const workSchedulesService = new WorkSchedulesService(db, cacheControlService);
const terminalsService = new TerminalsService(db, cacheControlService);
const organizationService = new OrganizationService(db, cacheControlService);
const usersTerminalsService = new UsersTerminalsService(db);
const sessionsService = new SessionsService(db);
const usersWorkSchedulesService = new UsersWorkSchedulesService(db);
const workScheduleEntriesService = new WorkScheduleEntriesService(db);
const apiTokensService = new ApiTokensService(db, cacheControlService);
const timesheetService = new TimesheetService(db);
const scheduledReportsService = new ScheduledReportsService(
  db,
  cacheControlService
);
const credentialsService = new CredentialsService(db, cacheControlService);
const settingsService = new SettingsService(db, cacheControlService);
const reportsService = new ReportsService(db, cacheControlService);
const reportsStatusService = new ReportsStatusService(db);

interface Meta {
  permission?: string;
}

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  return {
    // prisma: db,
    permissionsService,
    rolesService,
    rolesPermissionsService,
    usersService,
    usersPermissionsService,
    usersRolesService,
    workSchedulesService,
    terminalsService,
    organizationService,
    usersTerminalsService,
    cacheControlService,
    sessionsService,
    usersWorkSchedulesService,
    workScheduleEntriesService,
    apiTokensService,
    timesheetService,
    scheduledReportsService,
    credentialsService,
    settingsService,
    token: opts.req.headers.get("authorization")?.split(" ")[1] ?? null,
    currentUser: null as Omit<UsersWithRelations, "password"> | null,
    reportsService,
    reportsStatusService,
  };
};

const t = initTRPC
  .context<Awaited<ReturnType<typeof createContext>>>()
  .meta<Meta>()
  .create();
// @ts-ignore
export const checkPermission = t.middleware(async ({ meta, next, ctx }) => {
  if (!ctx.token) {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  if (!meta?.permission) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: "Forbidden",
    });
  }

  if (meta.permission) {
    let jwtResult = await verifyJwt(ctx.token);
    if (!jwtResult) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    if (!jwtResult.payload) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    let user = await ctx.usersService.findOne({
      where: {
        id: jwtResult.payload.id as string,
      },
      include: {
        users_roles_usersTousers_roles_user_id: true,
      },
    });

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const permissions = await ctx.cacheControlService.getPermissionsByRoleId(
      user.users_roles_usersTousers_roles_user_id[0].role_id
    );
    if (permissions.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    if (!permissions.includes(meta.permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    return next();
    // if (ctx.permissionsService.hasPermission(meta.permission)) {
    //   return next();
    // } else {
    //   throw new Error("No permission");
    // }
  } else {
    return next();
  }
});

// @ts-ignore
export const getUser = t.middleware(async ({ meta, next, ctx }) => {
  if (!ctx.token) {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  let jwtResult = await verifyJwt(ctx.token);
  if (!jwtResult) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  if (!jwtResult.payload) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }

  let user = await ctx.usersService.findOne({
    where: {
      id: jwtResult.payload.id as string,
    },
    include: {
      users_roles_usersTousers_roles_user_id: true,
    },
  });

  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Unauthorized",
    });
  }
  ctx.currentUser = user;

  return next();
  // if (ctx.permissionsService.hasPermission(meta.permission)) {
  //   return next();
  // } else {
  //   throw new Error("No permission");
  // }
  return next();
});

export const publicProcedure = t.procedure;
export const publicRouter = t.router;
