import Elysia from "elysia";
import { apiController } from "./controllers";
import { openapi } from '@elysiajs/openapi'
import { cors } from "@elysiajs/cors";

const app = new Elysia()

.use(
  cors()
)
  .get("/", () => '', {
    detail: {
      hide: true,
    },
  })
  .use(openapi())
  .use(apiController);

export default app;
export type App = typeof app;
