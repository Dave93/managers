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
  // Widened-type controller goes first: after apiController the accumulated
  // route type is near TS's instantiation-depth limit and any extra .use()
  // beyond medicalController overflows it (TS2589).
  .use(iikoSyncController)
  .use(apiController)
  .use(medicalController);

export default app;
export type App = typeof app;
