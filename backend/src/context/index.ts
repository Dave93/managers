import Elysia, { Context, error } from "elysia";
import { drizzleDb } from "@backend/lib/db";
import { cors } from "@elysiajs/cors";
import jwt from "@backend/jwt";
import { bearer } from "@elysiajs/bearer";
import { verifyJwt } from "@backend/lib/bcrypt";
import { users } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { CacheControlService } from "@backend/modules/cache_control/service";
import { Queue } from "bullmq";

const client = new Redis({
  port: 6379, // Redis port
  host: process.env.REDIS_HOST, // Redis host
  //   maxRetriesPerRequest: null,
});

const cacheControlService = new CacheControlService(drizzleDb, client);

export const ctx = new Elysia({
  name: "@app/ctx",
})
  .decorate("redis", client)
  .decorate("drizzle", drizzleDb)
  .decorate("cacheController", cacheControlService)
  .use(
    cors({
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
  )
  .derive(async ({ redis, cookie: { sessionId } }) => {
    const sessionIdValue = sessionId.value;
    if (!sessionIdValue) {
      return {
        user: null,
      };
    }

    try {
      let cachedUser = await redis.get(
        `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
      );
      return {
        user: cachedUser
          ? (JSON.parse(cachedUser) as {
            user: typeof users.$inferSelect;
            role: {
              id: string;
              name: string;
              code: string;
            };
            terminals: string[];
          })
          : null,
      };
    } catch (error) {
      console.log("error", error);
      return {
        user: null,
      };
    }
  })
  .macro(({ onBeforeHandle }) => ({
    permission(permission: string) {
      if (!permission) return;
      onBeforeHandle(
        async ({
          user,
          redis,
          error,
          cacheController,
          cookie: { sessionId, refreshToken },
        }) => {
          const sessionIdValue = sessionId.value;
          const refreshTokenValue = refreshToken.value;
          if (!sessionId.value) {
            return error(401, {
              message: "User not found",
            });
          }

          let cachedUser = await redis.get(
            `${process.env.PROJECT_PREFIX}user_data:${sessionIdValue}`
          );

          if (!cachedUser) {
            if (refreshTokenValue) {
              const cachedRefreshToken = await redis.get(
                `${process.env.PROJECT_PREFIX}refresh_token:${refreshTokenValue}`
              );
              if (!cachedRefreshToken) {
                return error(401, {
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
              }
            } else {
              return error(401, {
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
            return error(403, {
              message: "You don't have permissions",
            });
          }
        }
      );
    },
  }))
  .as("global");
