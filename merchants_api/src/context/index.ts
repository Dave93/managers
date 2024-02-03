import Elysia, { Context, error } from "elysia";
import { drizzleDb } from "@backend/lib/db";
import { cors } from "@elysiajs/cors";
import { bearer } from "@elysiajs/bearer";
import Redis from "ioredis";
import { CacheControlService } from "@backend/modules/cache_control/service";

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
        // @ts-ignore
        cors({
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        })
    )
    // @ts-ignore
    .use(bearer());
