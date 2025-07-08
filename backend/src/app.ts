import { Elysia } from "elysia";
import { apiController } from "./controllers";
import { cors } from '@elysiajs/cors'

const app = new Elysia()
  .use(cors())
  .get("/", () => ({ hello: "world" }))
  .use(apiController);

export default app;
export type App = typeof app;
