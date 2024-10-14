import { Elysia } from "elysia";
import { apiController } from "./controllers";

const app = new Elysia()
  .get("/", () => ({ hello: "world" }))
  .use(apiController);

export default app;
export type App = typeof app;
