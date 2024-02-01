import Elysia, { Context, error } from "elysia";
import { drizzleDb } from "@backend/lib/db";
import { cors } from "@elysiajs/cors";
import jwt from "@backend/jwt";
import { bearer } from "@elysiajs/bearer";
import { verifyJwt } from "@backend/lib/bcrypt";
import { users, users_roles } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { CacheControlService } from "@backend/modules/cache_control/service";
import { Queue } from "bullmq";

const client = new Redis({
    port: 6379, // Redis port
    host: "127.0.0.1", // Redis host
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
    .use(bearer())
    .use(jwt)
    .derive(async ({ bearer, cacheController }) => {
        const token = bearer;
        if (!token) {
            return {
                user: null,
            };
        }

        try {
            if (token == process.env.API_TOKEN) {
                return {
                    user: null,
                };
            }

            const res = await cacheController.getCachedUserDataByToken(token);

            return {
                user: res,
            };
        } catch (error) {
            console.log("error", error);
            return {
                user: null,
            };
        }
    });