import {
  apiTokensWithRelations,
  organizationWithCredentials,
  positionsWithRelations,
  terminalsWithCredentials,
  usersWithRelations,
  workSchedulesWithRelations,
} from "./dto/cache.dto";
import { DrizzleDB } from "@backend/lib/db";
import { InferSelectModel, eq, getTableColumns, sql } from "drizzle-orm";
import {
  api_tokens,
  corporation_store,
  credentials,
  organization,
  permissions,
  product_groups,
  reports_status,
  roles,
  roles_permissions,
  scheduled_reports,
  settings,
  users,
  users_stores,
  users_terminals,
  work_schedules,
} from "@backend/../drizzle/schema";
import { RolesWithRelations } from "../roles/dto/roles.dto";
import { verifyJwt } from "@backend/lib/bcrypt";
import Redis from "ioredis";
import crypto from "crypto";
import dayjs from "dayjs";
import WebSocket from "ws";
import puppeteer from "puppeteer";
import path from "path";

const { password, salt, tg_id, ...userDataFields } = getTableColumns(users);
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
    this.cacheReportStatuses();
    this.cacheStores();
    this.cachePositions();
    this.cacheUsers();
    this.cacheWorkSchedule();
    this.cacheUsersTerminalsByUserId();
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

  async cachePositions() {
    const positions = await this.drizzle.query.positions.findMany();

    const credentialsList = await this.drizzle.query.credentials.findMany({
      where: eq(credentials.model, "positions"),
    });

    const credentialsByPositionId = credentialsList.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, InferSelectModel<typeof credentials>[]>);

    const newPositions: positionsWithRelations[] = [];

    for (const position of positions) {
      const credentials = credentialsByPositionId[position.id];
      const newPosition: positionsWithRelations = {
        ...position,
        credentials: [],
      };
      if (credentials) {
        newPosition.credentials = credentials;
      }
      newPositions.push(newPosition);
    }

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}positions`,
      JSON.stringify(newPositions)
    );
  }

  async getCachedPositions({ take }: { take?: number }) {
    const positions = await this.redis.get(
      `${process.env.PROJECT_PREFIX}positions`,
    );
    let res = JSON.parse(positions ?? "[]") as positionsWithRelations[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }
    return res;

  }

  async cacheUsers() {
    const users = await this.drizzle.query.users.findMany();
    const credentialsList = await this.drizzle.query.credentials.findMany({
      where: eq(credentials.model, "users"),
    });
    const credentialsByUserId = credentialsList.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, InferSelectModel<typeof credentials>[]>);

    const newUsers: usersWithRelations[] = [];
    for (const user of users) {
      const credentials = credentialsByUserId[user.id];
      const newUser: usersWithRelations = {
        ...user,
        credentials: [],
      };
      if (credentials) {
        newUser.credentials = credentials;
      }
      newUsers.push(newUser);
    }

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}users`,
      JSON.stringify(newUsers)
    );
  }

  async getCachedUsers({ take }: { take?: number }) {
    const users = await this.redis.get(
      `${process.env.PROJECT_PREFIX}users`
    );
    let res = JSON.parse(users ?? "[]") as usersWithRelations[];

    if (take && res.length > take) {
      res = res.slice(0, take);
    }
    return res;
  }


  async cacheWorkSchedule() {
    const workSchedules = await this.drizzle.query.work_schedules.findMany();
    const credentialsList = await this.drizzle.query.credentials.findMany({
      where: eq(credentials.model, "work_schedules"),
    });

    const credentialsByScheduleId = credentialsList.reduce((acc, credential) => {
      if (!acc[credential.model_id]) {
        acc[credential.model_id] = [];
      }
      acc[credential.model_id].push(credential);
      return acc;
    }, {} as Record<string, InferSelectModel<typeof credentials>[]>);

    const newWorkSchedules: workSchedulesWithRelations[] = [];

    for (const schedule of workSchedules) {
      const credentials = credentialsByScheduleId[schedule.id];
      const newSchedule: workSchedulesWithRelations = {
        ...schedule,
        credentials: credentials || [],
      };
      newWorkSchedules.push(newSchedule);
    }

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}work_schedules`,
      JSON.stringify(newWorkSchedules)
    );
  }

  async getCachedWorkSchedule({ take }: { take?: number }) {
    const workSchedules = await this.redis.get(
      `${process.env.PROJECT_PREFIX}work_schedules`
    );
    let res = JSON.parse(workSchedules ?? "[]") as workSchedulesWithRelations[];

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

    for (const setting of settingsList) {
      await this.redis.set(
        `${process.env.PROJECT_PREFIX}setting:${setting.key}`,
        JSON.stringify(setting)
      );
    }
  }

  async getCachedSetting(key: string) {
    const setting = await this.redis.get(
      `${process.env.PROJECT_PREFIX}setting:${key}`
    );
    return JSON.parse(setting ?? "{}") as InferSelectModel<typeof settings>;
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

  async generateApiToken() {
    const token = crypto.randomBytes(32).toString("hex");
    return token;
  }

  async cacheUserDataByToken(userId: any) {
    const sessionId = await this.generateApiToken();
    const refreshToken = await this.generateApiToken();

    const foundUser = (
      await this.drizzle
        .select(userDataFields)
        .from(users)
        .where(eq(users.id, userId))
        .execute()
    )[0];
    if (!foundUser) {
      return null;
    }

    if (foundUser.status != "active") {
      return null;
    }

    const roles = await this.getCachedRoles({});
    const { permissions, ...userRoles } = roles.find(
      (role) => role.id === foundUser.role_id
    )!;
    console.log(
      "session_data",
      `${process.env.PROJECT_PREFIX}user_data:${sessionId}`
    );


    // getting user terminals

    const userTerminals = await this.drizzle.select({
      terminal_id: users_terminals.terminal_id,
    })
      .from(users_terminals).where(eq(users_terminals.user_id, foundUser.id)).execute();

    const userTerminalsIds = userTerminals.map(terminal => terminal.terminal_id);

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}user_data:${sessionId}`,
      JSON.stringify({
        user: foundUser,
        role: userRoles,
        terminals: userTerminalsIds,
      }),
      "EX",
      parseInt(process.env.SESSION_EXPIRES_IN ?? "0")
    );

    await this.redis.set(
      `${process.env.PROJECT_PREFIX}refresh_token:${refreshToken}`,
      JSON.stringify({
        sessionId,
        user: foundUser,
        role: userRoles,
        terminals: userTerminalsIds,
      }),
      "EX",
      parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN ?? "0")
    );

    return {
      user: foundUser,
      sessionId,
      refreshToken,
      role: userRoles,
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

  async cacheUsersTerminalsByUserId() {
    const usersTerminals = await this.drizzle
      .select({
        terminal_id: users_terminals.terminal_id,
        user_id: users_terminals.user_id,
      })
      .from(users_terminals)
      .execute();

    const usersTerminalsByUserId = usersTerminals.reduce((acc, cur) => {
      if (!acc[cur.user_id]) {
        acc[cur.user_id] = [];
      }
      acc[cur.user_id].push(cur.terminal_id);
      return acc;
    }, {} as Record<string, string[]>);

    for (const userTerminal of usersTerminals) {
      await this.redis.del(
        `${process.env.PROJECT_PREFIX}user_terminals:${userTerminal.user_id}`
      );
      await this.redis.rpush(
        `${process.env.PROJECT_PREFIX}user_terminals:${userTerminal.user_id}`,
        ...usersTerminalsByUserId[userTerminal.user_id]
      );
    }
  }

  async hasUserTerminal(userId: string, terminalId: string) {
    const userTerminals = await this.redis.lrange(
      `${process.env.PROJECT_PREFIX}user_terminals:${userId}`,
      0,
      -1
    );
    if (userTerminals) {
      return userTerminals.includes(terminalId);
    }
    return false;
  }

  async getIikoChainToken() {
    let token = await this.redis.get(
      `${process.env.PROJECT_PREFIX}iiko_chain_token`
    );
    if (!token) {
      const response = await fetch(
        `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${Bun.env.IIKO_LOGIN}&pass=${Bun.env.IIKO_PASS}`,
        {
          method: "GET",
        }
      );
      token = await response.text();
      await this.redis.set(
        `${process.env.PROJECT_PREFIX}iiko_chain_token`,
        token,
        "EX",
        parseInt(process.env.IIKO_CHAIN_TOKEN_EXPIRES_IN ?? "0")
      );
    }
    return token;
  }

  async getClickData(
    filterDate: string,
    clickServiceIds: string,
    workStartTime: string,
    workEndTime: string,
    time?: string
  ): Promise<number> {
    return await new Promise((resolve, reject) => {
      let totalSum = 0;
      const ws = new WebSocket(Bun.env.CLICK_WS_URL!, {
        maxPayload: 104857600,
      });
      let sesskey = "";
      const serviceIds = clickServiceIds.split(",");
      ws.on("open", () => {
        console.log("Connected to server");

        ws.send(
          JSON.stringify({
            method: "api.login",
            parameters: {
              login: Bun.env.CLICK_LOGIN,
              auth_pass: Bun.env.CLICK_PASSWORD,
              auth_ip: Bun.env.CLICK_AUTH_IP,
            },
          })
        );
      });

      let globalMessage = "";
      let isMessageFinished = false;

      ws.on("message", (message: string) => {
        if (Buffer.isBuffer(message)) {
          message = message.toString();
        }

        try {
          if (isMessageFinished) {
            globalMessage = message;
          } else {
            globalMessage += message;
          }
          JSON.parse(globalMessage);
          isMessageFinished = true;
        } catch (e) {
          isMessageFinished = false;
        }
        if (isMessageFinished) {
          let data = JSON.parse(globalMessage);
          globalMessage = "";
          if (data.method == "api.login") {
            console.log("data", data);
            if (data.data[0][0].result == "FAILED") {
              ws.close();
              return reject(data.data[0][0].error_note);
            }

            sesskey = data.data[0][0].seskey;

            for (let serviceId of serviceIds) {
              ws.send(
                JSON.stringify({
                  method: "api.get.user.report",
                  parameters: {
                    session_key: sesskey,
                    report_name: "payments",
                    service_id: serviceId,
                    cashbox_id: null,
                    cntrg_param1: null,
                    cntrg_param2: null,
                    click_paydoc_id: null,
                    date_from:
                      dayjs(filterDate).format("YYYY-MM-DD") +
                      ` ${workStartTime}:00:00`,
                    date_to: time
                      ? dayjs(filterDate).format("YYYY-MM-DD") + ` ${time}:00`
                      : dayjs(filterDate).add(1, "day").format("YYYY-MM-DD") +
                      ` ${workEndTime}:00:00`,
                    page_size: 50,
                    page_number: 1,
                    merchant_id: null,
                    phone_num: null,
                    status: "S",
                  },
                })
              );
            }
          }

          if (data.method == "api.get.user.report") {
            const rows = data.data[0];
            if (rows.length > 0 && !rows[0].error && data.data.length > 1) {
              totalSum += data.data[1][0].total;
            }

            ws.close();
            return resolve(totalSum);
          }
        }
      });

      ws.on("close", () => {
        console.log("Disconnected from server");
      });
    });
  }

  async getPaymeData(
    date: string,
    paymeMerchantIds: string,
    businessId: string,
    workStartTime: string,
    workEndTime: string,
    time?: string
  ) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36"
    );
    await page.goto(
      "https://merchant.payme.uz/auth/login?returnUrl=%2Fbusiness"
    );
    // Set screen size
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      const file = Bun.file(
        path.resolve(import.meta.dir, "./cookies.ignore.json")
      );
      const cookies = await file.json();
      await page.setCookie(...cookies);
    } catch (error) { }
    try {
      const file = Bun.file(
        path.resolve(import.meta.dir, "./localStorage.ignore.json")
      );
      const localStorage = await file.json();
      await page.evaluate((storage) => {
        for (const key in storage) {
          // @ts-ignore
          window.localStorage.setItem(key, storage[key]);
        }
      }, localStorage);
    } catch (error) {
      console.log("localStorage Error", error);
    }
    let authFormSelector = ".auth-content";

    await page.locator("pb-input:first-child input").fill(Bun.env.PAYME_LOGIN!);
    await page.locator("input[type=password]").fill(Bun.env.PAYME_PASSWORD!);
    console.log("page", 1132);
    await page.click('form button[class*="primary"]');

    try {
      const smsForm = await page.waitForSelector("pb-sms-confirm", {
        timeout: 500,
      });
      if (smsForm) {
        await smsForm?.waitForSelector("input");
        authFormSelector = "pb-sms-confirm";
        let file = Bun.file(
          path.resolve(import.meta.dir, "./paymedata.ignore.json")
        );
        let contents = await file.json();
        let smsCode = contents.payme_sms;

        while (smsCode.length < 6) {
          await new Promise((r) => setTimeout(r, 100));
          file = Bun.file(
            path.resolve(import.meta.dir, "./paymedata.ignore.json")
          );
          contents = await file.json();
          smsCode = contents.payme_sms;
          if (smsCode.length === 6) {
            await page.locator("pb-sms-confirm input[type=text]").fill(smsCode);
            await page
              .locator('pb-sms-confirm button[class*="primary"]')
              .click();
            const businessPage = await page.waitForSelector(
              ".businesses-items"
            );
            if (!businessPage) {
              smsCode = "";
            } else {
              authFormSelector = ".businesses-items";
            }
          }
        }
      }
      const cookies = await page.cookies();
      const cookieJson = JSON.stringify(cookies, null, 2);
      await Bun.write(
        path.resolve(import.meta.dir, "./cookies.ignore.json"),
        cookieJson
      );
      const localStorage: any = await page.evaluate(() => {
        const localStorage = window.localStorage;
        return JSON.stringify(localStorage);
      });
      await Bun.write(
        path.resolve(import.meta.dir, "./localStorage.ignore.json"),
        localStorage
      );
    } catch (error) {
      // console.log("error", error);
      const cookies = await page.cookies();
      const cookieJson = JSON.stringify(cookies, null, 2);
      await Bun.write(
        path.resolve(import.meta.dir, "./cookies.ignore.json"),
        cookieJson
      );
      let localStorage: any = await page.evaluate(() => {
        return JSON.stringify(window.localStorage);
      });
      await Bun.write(
        path.resolve(import.meta.dir, "./localStorage.ignore.json"),
        localStorage
      );
      localStorage = JSON.parse(localStorage);
      const pbAT = JSON.parse(localStorage.__pbAT || "{}");

      if (pbAT && Object.entries(pbAT).length === 0) {
        await browser.close();
        return 0;
      }
      const {
        auth: { token },
      } = pbAT;
      const payments = await page.evaluate(
        async (params) => {
          const result = await fetch(
            "https://merchant.payme.uz/api/receipts.find",
            {
              headers: {
                accept: "application/json, text/plain, */*",
                "accept-language": "ru",
                authentication: "Bearer " + params.token,
                "content-type": "application/json",
                "sec-ch-ua": '"Not)A;Brand";v="24", "Chromium";v="116"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"macOS"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
              },
              referrer:
                "https://merchant.payme.uz/business/5fb61b0af8caf1c00e7e4259/merchants/5fb63e71f8caf1c00e7e47ca/receipts",
              referrerPolicy: "strict-origin-when-cross-origin",
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "receipts.find",
                params: {
                  filter: params.filter,
                  options: { limit: 1000, skip: 0, sort: -1 },
                },
              }),
              method: "POST",
              mode: "cors",
              credentials: "include",
            }
          );
          return result.json();
        },
        {
          filter: {
            business_id: businessId,
            merchant_id: paymeMerchantIds.split(","),
            date_from: dayjs(date).hour(+workStartTime).toISOString(),
            date_to: time
              ? dayjs(date)
                .hour(+time.split(":")[0])
                .minute(+time.split(":")[1])
                .second(0)
                .toISOString()
              : dayjs(date).add(1, "day").hour(+workEndTime).toISOString(),
            state: [4, 104],
          },
          token,
        }
      );
      await browser.close();
      if (payments.result) {
        let totalSum = 0;
        payments.result.forEach((payment: any) => {
          totalSum += payment.amount / 100;
        });
        return totalSum;
      } else {
        return 0;
      }
    }
  }

  async getIikoData(date: string, iikoId: string): Promise<number> {
    const token = await this.getIikoChainToken();
    console.log(
      "iiko url",
      `https://les-ailes-co-co.iiko.it/resto/api/v2/cashshifts/list?openDateFrom=${dayjs(
        date
      ).format("YYYY-MM-DD")}&openDateTo=${dayjs(date).format(
        "YYYY-MM-DD"
      )}&groupId=${iikoId}&status=CLOSED&key=${token}`
    );
    const cachierReport = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/cashshifts/list?openDateFrom=${dayjs(
        date
      ).format("YYYY-MM-DD")}&openDateTo=${dayjs(date).format(
        "YYYY-MM-DD"
      )}&groupId=${iikoId}&status=CLOSED&key=${token}`
    );

    const reportBody = await cachierReport.json();
    return reportBody.reduce((acc: number, item: any) => {
      return acc + item.payOrders;
    }, 0);
  }

  async getIikoCachierData(date: string, iikoId: string): Promise<string[]> {
    const token = await this.getIikoChainToken();
    const cachierReport = await fetch(
      `https://les-ailes-co-co.iiko.it/resto/api/v2/cashshifts/list?openDateFrom=${dayjs(
        date
      ).format("YYYY-MM-DD")}&openDateTo=${dayjs(date).format(
        "YYYY-MM-DD"
      )}&groupId=${iikoId}&status=CLOSED&key=${token}`
    );
    const reportBody = await cachierReport.json();
    return reportBody.map((item: any) => item.id);
  }

  async getExpressData(
    filterDate: string,
    iikoId: string,
    workStartTime: string,
    workEndTime: string,
    organizationCode: string,
    time?: string
  ) {
    let result: {
      express: number;
      yandex_eats: number;
      my_uzcard: number;
      wolt: number;
    } = {
      express: 0,
      yandex_eats: 0,
      my_uzcard: 0,
      wolt: 0,
    };

    const response = await fetch(
      `${Bun.env["ECOMMERCE_" + organizationCode + "_URL"]}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Bun.env["ECOMMERCE_TOKEN"]}`,
        },
        body: JSON.stringify({
          iiko_id: iikoId,
          dateFrom: dayjs(filterDate)
            .hour(+workStartTime)
            .minute(0)
            .second(0)
            .toISOString(),
          dateTo: time
            ? dayjs(filterDate)
              .hour(+time.split(":")[0])
              .minute(+time.split(":")[1])
              .second(0)
              .toISOString()
            : dayjs(filterDate)
              .add(1, "day")
              .hour(+workEndTime)
              .minute(0)
              .second(0)
              .toISOString(),
        }),
      }
    );

    const expressResponse = (await response.json()).result.data;
    result.express = +expressResponse.express;
    result.yandex_eats = +expressResponse.yandex_eats;
    result.my_uzcard = +expressResponse.my_uzcard;
    result.wolt = +expressResponse.wolt;
    return result;
  }

  async getArrytData(
    filterDate: string,
    iikoId: string,
    workStartTime: string,
    workEndTime: string,
    organizationArrytToken: string,
    time?: string
  ) {
    let result: {
      customerPrice: number;
      withdraws: {
        first_name: string;
        last_name: string;
        amount: number;
      }[];
    } = {
      customerPrice: 0,
      withdraws: [],
    };

    const response = await fetch(process.env.ARRYT_WITHDRAW_API!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${organizationArrytToken}`,
      },
      body: JSON.stringify({
        terminal_id: iikoId,
        date_from: dayjs(filterDate)
          .hour(+workStartTime)
          .minute(0)
          .second(0)
          .toISOString(),
        date_to: time
          ? dayjs(filterDate)
            .hour(+time.split(":")[0])
            .minute(+time.split(":")[1])
            .second(0)
            .toISOString()
          : dayjs(filterDate)
            .add(1, "day")
            .hour(+workEndTime)
            .minute(0)
            .second(0)
            .toISOString(),
      }),
    });

    result = await response.json();
    return result;
  }
}
