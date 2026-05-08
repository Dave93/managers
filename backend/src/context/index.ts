import Elysia from "elysia";
import { drizzleDb } from "@backend/lib/db";
import { users } from "backend/drizzle/schema";
import { getCacheControlService, getRedisClient } from "@backend/lib/shared-instances";

const client = getRedisClient();


type UserContext = {
  user: typeof users.$inferSelect | null;
  role: {
    id: string;
    name: string;
    code: string;
  } | null;
  terminals: string[];
};

const cacheControlService = getCacheControlService();

export const ctx = new Elysia({
  name: "@app/ctx",
})
  .decorate("redis", client)
  .decorate("drizzle", drizzleDb)
  .decorate("cacheController", cacheControlService)
  // .derive(async ({ redis, cookie: { sessionId } }) => {
  //   const sessionIdValue = sessionId.value;
  //   console.log("sessionIdValue", sessionIdValue);
  //   if (!sessionIdValue) {
  //     return {
  //       user: null,
  //     };
  //   }

  //   try {
  //     let cachedUser = await redis.get(
  //       `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
  //     );
  //     return {
  //       user: cachedUser
  //         ? (JSON.parse(cachedUser) as {
  //           user: typeof users.$inferSelect;
  //           role: {
  //             id: string;
  //             name: string;
  //             code: string;
  //           };
  //           terminals: string[];
  //         })
  //         : null,
  //     };
  //   } catch (error) {
  //     console.log("error", error);
  //     return {
  //       user: null,
  //     };
  //   }
  // })
  .macro({

    permission(permission: string) {
      if (!permission) {

        return {
          resolve: (): UserContext => ({
            user: null,
            role: null,
            terminals: [],
          })
        };
      }

      return {
        beforeHandle: async ({
          redis,
          status,
          cacheController,
          cookie: { sessionId, refreshToken },
          path,
        }) => {
          const sessionIdValue = sessionId.value;
          const refreshTokenValue = refreshToken.value;
          const dbg = (msg: string, extra?: any) =>
            console.log(`[ctx beforeHandle] ${path} permission=${permission}: ${msg}`, extra ?? "");
          dbg("entered", {
            hasSession: !!sessionIdValue,
            hasRefresh: !!refreshTokenValue,
            sessionPrefix: sessionIdValue ? sessionIdValue.slice(0, 8) : null,
          });
          if (!sessionId.value) {
            dbg("no sessionId cookie -> 401");
            return status(401, {
              message: "User not found",
            });
          }

          let cachedUser = await redis.get(
            `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
          );
          dbg("user_data cache lookup", { hit: !!cachedUser });

          if (!cachedUser) {
            if (refreshTokenValue) {
              const cachedRefreshToken = await redis.get(
                `${process.env.PROJECT_PREFIX}refresh_token:${refreshTokenValue}`
              );
              dbg("refresh_token cache lookup", { hit: !!cachedRefreshToken });
              if (!cachedRefreshToken) {
                dbg("no refresh_token cache -> 401");
                return status(401, {
                  message: "User not found",
                });
              } else {
                const { user, role } = JSON.parse(cachedRefreshToken);
                await redis.set(
                  `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`,
                  JSON.stringify({ user, role }),
                  "EX",
                  parseInt(process.env.SESSION_EXPIRES_IN ?? "0")
                );
                cachedUser = await redis.get(
                  `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
                );
                dbg("recovered user_data from refresh_token", {
                  hasUser: !!user,
                  userId: user?.id ?? null,
                  hasTerminals: false, // beforeHandle recovery skips terminals
                });
              }
            } else {
              dbg("no refresh cookie -> 401");
              return status(401, {
                message: "User not found",
              });
            }
          }

          // check `${process.env.PROJECT_PREFIX}user_data:${sessionId}` redis key expiration is less than 10 minutes
          const redisUserExpiration = await redis.ttl(
            `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
          );
          if (redisUserExpiration < 600) {
            await redis.expire(
              `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`,
              parseInt(process.env.SESSION_EXPIRES_IN ?? "0")
            );
          }

          const { role } = JSON.parse(cachedUser!) as {
            user: typeof users.$inferSelect;
            role: {
              id: string;
              name: string;
              code: string;
            };
            terminals: string[];
          };
          const permissions = await cacheController.getPermissionsByRoleId(
            role.id
          );

          if (!permissions.includes(permission)) {
            return status(403, {
              message: "You don't have permissions",
            });
          }
        },
        resolve: async ({
          redis,
          cookie: { sessionId, refreshToken },
          path,
        }) => {
          const sessionIdValue = sessionId.value;
          const refreshTokenValue = refreshToken.value;
          const dbg = (msg: string, extra?: any) =>
            console.log(`[ctx resolve] ${path} permission=${permission}: ${msg}`, extra ?? "");
          dbg("entered", {
            hasSession: !!sessionIdValue,
            hasRefresh: !!refreshTokenValue,
            sessionPrefix: sessionIdValue ? sessionIdValue.slice(0, 8) : null,
          });
          if (!sessionId.value) {
            dbg("no sessionId -> user=null");
            return { user: null, role: null, terminals: [] } as UserContext;
          }

          let cachedUser = await redis.get(
            `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
          );
          dbg("user_data cache lookup", { hit: !!cachedUser });

          // If user_data cache is gone (TTL evicted between beforeHandle and
          // resolve, or resolve runs before beforeHandle in macro ordering),
          // try the same recovery path beforeHandle uses — fall back to the
          // refresh-token-keyed cache.
          if (!cachedUser && refreshTokenValue) {
            const cachedRefreshToken = await redis.get(
              `${process.env.PROJECT_PREFIX}refresh_token:${refreshTokenValue}`
            );
            dbg("refresh_token cache lookup", { hit: !!cachedRefreshToken });
            if (cachedRefreshToken) {
              await redis.set(
                `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`,
                cachedRefreshToken,
                "EX",
                parseInt(process.env.SESSION_EXPIRES_IN ?? "0")
              );
              cachedUser = cachedRefreshToken;
              dbg("recovered user_data from refresh_token");
            }
          }

          if (!cachedUser) {
            dbg("no cache after recovery -> user=null");
            return { user: null, role: null, terminals: [] } as UserContext;
          }

          let parsed: any;
          try {
            parsed = JSON.parse(cachedUser!);
          } catch (e) {
            dbg("JSON.parse failed, returning user=null", { error: String(e) });
            return { user: null, role: null, terminals: [] } as UserContext;
          }

          const result = {
            user: parsed?.user ?? null,
            role: parsed?.role ?? null,
            terminals: parsed?.terminals ?? [],
          };
          dbg("resolved", {
            hasUser: !!result.user,
            userId: result.user?.id ?? null,
            hasRole: !!result.role,
            terminalsCount: Array.isArray(result.terminals) ? result.terminals.length : 0,
            cachedKeys: Object.keys(parsed ?? {}),
          });
          return result;
        },
      }
    },
    userAuth(enabled: boolean) {
      if (!enabled) {
        return {
          resolve: (): UserContext => ({
            user: null,
            role: null,
            terminals: [],
          }),
        };
      }

      return {
        resolve: async ({
          redis,
          cookie: { sessionId, refreshToken },
        }) => {

          const sessionIdValue = sessionId.value;
          const refreshTokenValue = refreshToken.value;
          if (!sessionId.value) {
            return { user: null, role: null, terminals: [] } as UserContext;
          }

          let cachedUser = await redis.get(
            `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
          );

          if (!cachedUser) {
            return { user: null, role: null, terminals: [] } as UserContext;
          }

          const { user: localUser, role, terminals } = JSON.parse(cachedUser!) as {
            user: typeof users.$inferSelect;
            role: {
              id: string;
              name: string;
              code: string;
            };
            terminals: string[];
          };

          return { user: localUser, role, terminals };
        }
      };
    },
  })
  .as("global");
