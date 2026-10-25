import { ctx } from "@backend/context";
import Elysia from "elysia";
import { meRoutes } from "./routes/me";
import { periodsRoutes } from "./routes/periods";
import { settingsRoutes } from "./routes/settings";

const kpiControllerImpl = new Elysia({ name: "@api/kpi", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .use(meRoutes)
  .use(settingsRoutes)
  .use(periodsRoutes);

export const kpiController = kpiControllerImpl as unknown as Elysia;
