import { Elysia, t as T } from "elysia";
// import { compile as c, trpc } from "@elysiajs/trpc";
// import { initTRPC } from "@trpc/server";
// import { z } from "zod";
// import {
//   arrytReportInputSchema,
//   clickReportInputSchema,
//   expressReportInputSchema,
//   iikoCachierReportInputSchema,
//   paymeReportInputSchema,
//   yandexReportInputSchema,
// } from "./z_objects";
// import { getPaymeReport } from "./services/payme_report";
// import { getClickReport } from "./services/click_report";

// import Redis from "ioredis";
// import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
// import { getYandexReport } from "./services/yandex_report";
// import { getIikoCachierReport } from "./services/iiko_cachier";
// import { getExpressReport } from "./services/express_report";
// import { getArrytReport } from "./services/arryt_report";
import { apiController } from "./modules/controllers";

// const redis = new Redis({
//   host: "localhost",
//   port: 6379,
// });

// export type RedisClientType = typeof redis;

// export const createContext = async (opts: FetchCreateContextFnOptions) => {
//   return {
//     redis,
//     token: opts.req.headers.get("authorization")?.split(" ")[1] ?? null,
//   };
// };

// const t = initTRPC
//   .context<Awaited<ReturnType<typeof createContext>>>()
//   .create();
// const p = t.procedure;

// const router = t.router({
//   greet: p

//     // 💡 Using Zod
//     //.input(z.string())
//     // 💡 Using Elysia's T
//     .input(c(T.String()))
//     .query(({ input }) => input),
//   getPaymeReport: p
//     .input(paymeReportInputSchema)
//     .query(({ input, ctx }) => getPaymeReport(input, ctx.redis)),
//   getClickReport: p
//     .input(clickReportInputSchema)
//     .query(({ input, ctx }) => getClickReport(input, ctx.redis)),
//   getYandexReport: p
//     .input(yandexReportInputSchema)
//     .query(({ input, ctx }) => getYandexReport(input, ctx.redis)),
//   getIikoCachierReport: p
//     .input(iikoCachierReportInputSchema)
//     .query(({ input, ctx }) => getIikoCachierReport(input, ctx.redis)),
//   getExpressReport: p
//     .input(expressReportInputSchema)
//     .query(({ input, ctx }) => getExpressReport(input, ctx.redis)),
//   getArrytReport: p
//     .input(arrytReportInputSchema)
//     .query(({ input, ctx }) => getArrytReport(input, ctx.redis)),
// });

// export type Router = typeof router;

const app = new Elysia()
  .use(apiController)
  // .use(
  //   trpc(router, {
  //     createContext,
  //   })
  // )
  .get("/", () => "Hello Elysia")
  .listen(50051);

export type App = typeof app;
console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port} `
);
