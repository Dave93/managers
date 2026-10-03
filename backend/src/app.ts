import Elysia from "elysia";
import { apiController } from "./controllers";
import { medicalController } from "./modules/medical/controller";
import { iikoSyncController } from "./modules/iiko_sync/controllers";
import { stoplistController } from "./modules/stoplist/controller";
import { productLinksController } from "./modules/product_links/controller";
import { cashShiftsController } from "./modules/cash_shifts/controller";
import { creditAdminController } from "./modules/credit_admin/controller";
import { passportController } from "./modules/passport/controller";
import { passportTgController } from "./modules/passport/tg-controller";
import { networkMapController } from "./modules/terminals/network-map";
import { staffBoardController } from "./modules/terminals/staff-board";
import { ticketsController } from "./modules/tickets/controller";
import { ticketsBotController } from "./modules/tickets/bot-controller";
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
  // Widened-type controllers go first: after apiController the accumulated
  // route type is near TS's instantiation-depth limit and any extra .use()
  // beyond medicalController overflows it (TS2589). creditAdminController
  // moved here from apiController's chain for the same reason (see comment
  // above creditAdminControllerImpl in modules/credit_admin/controller.ts).
  .use(iikoSyncController)
  .use(productLinksController)
  .use(stoplistController)
  .use(cashShiftsController)
  .use(creditAdminController)
  .use(passportController)
  .use(passportTgController)
  .use(networkMapController)
  .use(staffBoardController)
  .use(ticketsController)
  .use(ticketsBotController)
  .use(apiController)
  .use(medicalController);

export default app;
export type App = typeof app;
