import { ctx } from "@backend/context";
import Elysia from "elysia";
import { attendanceRoutes } from "./routes/attendance";
import { cardsRoutes } from "./routes/cards";
import { disputesRoutes } from "./routes/disputes";
import { employeesRoutes } from "./routes/employees";
import { evaluatorsRoutes } from "./routes/evaluators";
import { meRoutes } from "./routes/me";
import { periodsRoutes } from "./routes/periods";
import { raisesRoutes } from "./routes/raises";
import { reviewsRoutes } from "./routes/reviews";
import { settingsRoutes } from "./routes/settings";
import { telegramRoutes } from "./routes/telegram";
import { violationsRoutes } from "./routes/violations";

const kpiControllerImpl = new Elysia({ name: "@api/kpi", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .use(meRoutes)
  .use(settingsRoutes)
  .use(periodsRoutes)
  .use(cardsRoutes)
  .use(evaluatorsRoutes)
  .use(employeesRoutes)
  .use(reviewsRoutes)
  .use(violationsRoutes)
  .use(attendanceRoutes)
  .use(disputesRoutes)
  .use(raisesRoutes)
  .use(telegramRoutes);

export const kpiController = kpiControllerImpl as unknown as Elysia;
