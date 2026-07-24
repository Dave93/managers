import Elysia from "elysia";
import { apiController } from "./controllers";
import { medicalController } from "./modules/medical/controller";
import { iikoSyncController } from "./modules/iiko_sync/controllers";
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
  .use(medicalController)
  // Cast: the endpoint is called by external services over plain HTTP (no
  // Eden client), and one more typed .use() overflows TS instantiation depth.
  .use(iikoSyncController as any);

export default app;
export type App = typeof app;
