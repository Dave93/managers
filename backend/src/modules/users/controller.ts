import Elysia, { t } from "elysia";
import { users, users_terminals } from "@backend/../drizzle/schema";
import { createHash, createHmac } from "crypto";
import {
  InferSelectModel,
  SQLWrapper,
  and,
  eq,
  getTableColumns,
  sql,
} from "drizzle-orm";
import {
  comparePassword,
  hashPassword,
  signJwt,
  verifyJwt,
} from "@backend/lib/bcrypt";
import { SelectedFields } from "drizzle-orm/pg-core";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { createInsertSchema } from "drizzle-typebox";
import { ctx } from "@backend/context";
import dayjs from "dayjs";
const { password, salt, tg_id, ...userDataFields } = getTableColumns(users);
type UsersModel = InferSelectModel<typeof users>;

function exclude<User extends Record<string, unknown>, Key extends keyof User>(
  user: User,
  keys: Key[]
): Omit<User, Key> {
  const filteredEntries = Object.entries(
    user as Record<string, unknown>
  ).filter(([key]) => !keys.includes(key as Key));
  const filteredObject = Object.fromEntries(filteredEntries) as unknown as Omit<
    User,
    Key
  >;
  return filteredObject;
}

export const usersController = new Elysia({
  name: "@api/users",
})
  .use(ctx)
  .post(
    "/users/login",
    async ({
      body: { login, password },
      set,
      cacheController,
      drizzle,
      cookie,
    }) => {
      const userPasswords = (
        await drizzle
          .select({
            password: users.password,
            salt: users.salt,
            status: users.status,
            id: users.id,
          })
          .from(users)
          .where(eq(users.login, login))
          .execute()
      )[0];
      if (!userPasswords) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }

      const isPasswordSame = await comparePassword(
        password,
        userPasswords!.salt!,
        userPasswords!.password
      );

      if (!isPasswordSame) {
        set.status = 401;
        return {
          message: "Password is incorrect",
        };
      }

      if (userPasswords.status == "blocked") {
        set.status = 401;
        return {
          message: "User is blocked",
        };
      }
      const res = await cacheController.cacheUserDataByToken(userPasswords.id);

      if (!res) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }

      const {
        sessionId: generatedSessionId,
        refreshToken: generatedRefreshToken,
        ...result
      } = res;

      cookie.sessionId.value = generatedSessionId;
      cookie.refreshToken.value = generatedRefreshToken;

      if (process.env.ENV == "development") {
        cookie.sessionId.domain = "localhost";
        cookie.refreshToken.domain = "localhost";
        cookie.sessionId.sameSite = "lax"; // или "none" с secure: true
        cookie.refreshToken.sameSite = "lax";
    } else {
        // Use .arryt.uz as the domain to make cookies work across all subdomains
        cookie.sessionId.domain = "lesailes.uz";
        cookie.refreshToken.domain = "lesailes.uz";
        cookie.sessionId.sameSite = "lax"; // или "none" с secure: true
        cookie.refreshToken.sameSite = "lax";
    }

      return result;
    },
    {
      body: t.Object({
        login: t.String(),
        password: t.String(),
      }),
    }
  )

  .post(
    "/users/refresh_token",
    async ({ body: { refreshToken }, set, cacheController, drizzle }) => {
      let jwtResult = await verifyJwt(refreshToken);
      if (!jwtResult) {
        set.status = 401;
        return {
          message: "Invalid token",
        };
      }

      if (!jwtResult.payload) {
        set.status = 401;
        return {
          message: "Invalid token",
        };
      }
      const user = (
        await drizzle
          .select(userDataFields)
          .from(users)
          .where(eq(users.id, jwtResult.payload.id as string))
          .execute()
      )[0];

      if (!user) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }

      if (user.status != "active") {
        set.status = 401;
        return {
          message: "User is blocked",
        };
      }

      const accessToken = await signJwt(
        {
          id: user.id,
          login: user.login,
          first_name: user.first_name,
          last_name: user.last_name,
        },
        process.env.JWT_EXPIRES_IN
      );

      const refreshTokenNew = await signJwt(
        {
          id: user.id,
          login: user.login,
          first_name: user.first_name,
          last_name: user.last_name,
        },
        process.env.JWT_REFRESH_EXPIRES_IN
      );

      const res = await cacheController.cacheUserDataByToken(user.id);

      if (!res) {
        set.status = 401;
        return {
          message: "User not found",
        };
      }
      return res;
    },
    {
      body: t.Object({
        refreshToken: t.String(),
      }),
    }
  )
  // .post(
  //   "/users/assign_role",
  //   async ({ body: { user_id, role_id }, user, set, drizzle }) => {
  //     if (!user) {
  //       set.status = 401;
  //       return {
  //         message: "User not found",
  //       };
  //     }
  //     //@ts-ignore
  //     if (!user.permissions.includes("users.edit")) {
  //       set.status = 401;
  //       return {
  //         message: "You don't have permissions",
  //       };
  //     }

  //     await drizzle
  //       .delete(users_roles)
  //       .where(eq(users_roles.user_id, user_id))
  //       .execute();
  //     await drizzle.insert(users_roles).values({ user_id, role_id }).execute();
  //     return {
  //       data: {
  //         user_id,
  //         role_id,
  //       },
  //     };
  //   },
  //   {
  //     body: t.Object({
  //       user_id: t.String(),
  //       role_id: t.String(),
  //     }),
  //   }
  // )
  .post(
    "/users/assign_terminal",
    async ({ body: { user_id, terminal_id }, user, set, drizzle }) => {

      await drizzle
        .delete(users_terminals)
        .where(eq(users_terminals.user_id, user_id))
        .execute();
      await drizzle
        .insert(users_terminals)
        .values(terminal_id.map((item) => ({ user_id, terminal_id: item })))
        .execute();
      return {
        data: {
          user_id,
          terminal_id,
        },
      };
    },
    {
      permission: "users.add",
      body: t.Object({
        user_id: t.String(),
        terminal_id: t.Array(t.String()),
      }),
    }
  )
  .get(
    "/users",
    async ({
      query: { limit, offset, sort, filters, fields },
      user,
      set,
      drizzle,
    }) => {
      let res: {
        [key: string]: UsersModel & {
          work_schedules: {
            id: string;
            user_id: string;
            work_schedule_id: string;
            start_time: string;
            end_time: string;
            day: string;
          }[];
        };
      } = {};

      let selectFields: SelectedFields = {};
      if (fields) {
        fields = fields
          .split(",")
          .filter((item) => item != "password")
          .join(",");
        selectFields = parseSelectFields(fields, users, {});
      }
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) {
        whereClause = parseFilterFields(filters, users, {});
      }
      const usersCount = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(...whereClause))
        .execute();

      const { password, salt, ...usersFields } = getTableColumns(users);

      const usersDbSelect = drizzle
        .select(usersFields)
        .from(users)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .as("users");

      // @ts-ignore
      const usersList: UsersModel[] = await drizzle
        .select(selectFields)
        .from(usersDbSelect)
        .execute();
      console.log(
        "sql",
        drizzle.select(selectFields).from(usersDbSelect).toSQL().sql
      );
      usersList.forEach((user) => {
        if (!res[user.id]) {
          res[user.id] = {
            ...user,
            work_schedules: [],
          };
        }
        // @ts-ignore
        if (user.work_schedules) {
          // @ts-ignore
          res[user.id].work_schedules.push(user.work_schedules);
        }
      });

      return {
        total: usersCount[0].count,
        data: Object.values(res),
      };
    },
    {
      permission: "users.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get("/users/me", async ({
    user,
    role,
    status
  }) => {
    if (!user) {
      return status(401, "Unauthorized");
    }

    return {
      user,
      role,
    };
  }, {
    userAuth: true
  })
  .get("/users/my_permissions", async ({ user, role, set, cacheController }) => {
    if (!user) {
      set.status = 401;
      return {
        message: "User not found",
      };
    }

    const permissions = await cacheController.getPermissionsByRoleId(
      role!.id
    );

    return { permissions };
  },
  {
    userAuth: true
  }
).post("/users/logout", async ({
  cookie,
  cacheController,
  status
}) => {

  if (cookie.sessionId.value && cookie.refreshToken.value) {
      await cacheController.deleteUserDataByToken(cookie.sessionId.value as string);
      await cacheController.deleteUserDataByToken(cookie.refreshToken.value as string);
  }

  delete cookie.sessionId.value;
  delete cookie.refreshToken.value;
  
  if (process.env.ENV === "development") {
      cookie.sessionId.domain = "localhost";
      cookie.refreshToken.domain = "localhost";
  } else {
      cookie.sessionId.domain = "arryt.uz";
      cookie.refreshToken.domain = "arryt.uz";
  }

  return {
      message: "Logged out successfully"
  };
}, {
  userAuth: true
})
  .get(
    "/users/:id",
    async ({
      params: { id },
      // @ts-ignore
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      const { password, salt, ...usersFields } = getTableColumns(users);
      const permissionsRecord = await drizzle
        .select(usersFields)
        .from(users)
        .where(eq(users.id, id))
        .execute();
      return {
        data: permissionsRecord[0],
      };
    },
    {
      permission: "users.one",
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  .get("/users/cached", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle, cacheController }) => {
    const usersList = await cacheController.getCachedUsers({});
    return usersList;
  },
    {
      permission: "users.list",
    })
  .post(
    "/users",
    //@ts-ignore
    async ({ body: { data, fields }, user, set, drizzle, cacheController }) => {
      if (data.password) {
        const { hash, salt } = await hashPassword(data.password);
        data.password = hash;
        data.salt = salt;
      }
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, users, {});
      } else {
        selectFields = {
          id: users.id,
        };
      }
      const result = await drizzle
        .insert(users)
        .values(data)
        .returning(selectFields);

      await cacheController.cacheUsersTerminalsByUserId();

      return result[0];
    },
    {
      permission: "users.add",
      body: t.Object({
        data: createInsertSchema(users) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  )
  .put(
    "/users/:id",
    async ({
      params: { id },
      body: { data, fields },
      user,
      set,
      drizzle,
      cacheController,
    }) => {
      let selectFields = {};
      if (fields) {
        selectFields = parseSelectFields(fields, users, {});
      }

      if (data.password) {
        let password = data.password;
        if (typeof password != "string") {
          password = password.set!;
        }
        const { hash, salt } = await hashPassword(password);
        data.password = hash;
        data.salt = salt;
      }

      const result = await drizzle
        .update(users)
        .set(data)
        .where(eq(users.id, id))
        .returning(selectFields);

      await cacheController.cacheUsersTerminalsByUserId();

      return {
        data: result[0],
      };
    },
    {
      permission: "users.edit",
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        // @ts-ignore
        data: createInsertSchema(users) as any,
        fields: t.Optional(t.Array(t.String())),
      }),
    }
  );
