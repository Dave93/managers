import { ctx } from "@backend/context";
import Elysia from "elysia";
import { cardsRoutes } from "./routes/cards";
import { employeesRoutes } from "./routes/employees";
import { evaluatorsRoutes } from "./routes/evaluators";
import { meRoutes } from "./routes/me";
import { periodsRoutes } from "./routes/periods";
import { reviewsRoutes } from "./routes/reviews";
import { settingsRoutes } from "./routes/settings";

const kpiControllerImpl = new Elysia({ name: "@api/kpi", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .use(meRoutes)
  .use(settingsRoutes)
  .use(periodsRoutes)
  .use(cardsRoutes)
  .use(evaluatorsRoutes)
  .use(employeesRoutes)
  .use(reviewsRoutes);

export const kpiController = kpiControllerImpl as unknown as Elysia;
