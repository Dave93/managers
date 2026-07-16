import Elysia from "elysia";
import { apiController } from "./controllers";
import { medicalController } from "./modules/medical/controller";
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
  .use(apiController)
  .use(medicalController);

export default app;
export type App = typeof app;
