import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, parsePeriod, requireAny } from "../access";
import { commitImport, listImports, parseUpload } from "../attendance";
import { loadAttendanceBoard } from "../attendance-board";
import { run } from "../errors";

export const attendanceRoutes = new Elysia({ name: "@api/kpi/attendance" })
  .use(ctx)
  .post(
    "/kpi/attendance/parse",
    async ({ body, user, redis, set }) => run(set, async () => parseUpload(redis, user!.id, body.file)),
    {
      permission: "kpi.manage",
      type: "multipart/form-data",
      // Любое значение: неверный файл — наш код ошибки, а не ответ схемы
      body: t.Object({ file: t.Optional(t.Any()) }),
    }
  )
  .post(
    "/kpi/attendance/commit",
    async ({ body, user, redis, drizzle, set }) =>
      run(set, async () => commitImport(drizzle, redis, user!.id, body as Record<string, unknown>)),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  )
  .get(
    "/kpi/attendance/imports",
    async ({ query, drizzle, set }) => run(set, async () => listImports(drizzle, parsePeriod(query.period))),
    { permission: "kpi.manage", query: t.Object({ period: t.Optional(t.String()) }) }
  )
  // Табель месяца для просмотра. Права те же, что у экранов «Сеть» и «Филиал»; видимость по филиалам решает loadAttendanceBoard (фильтры по филиалу и имени — на клиенте).
  .get(
    "/kpi/attendance/board",
    async ({ query, user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.view", "kpi.manage", "kpi.approve"]);
        return loadAttendanceBoard(drizzle, actor, { period: parsePeriod(query.period) });
      }),
    { userAuth: true, query: t.Object({ period: t.Optional(t.String()) }) }
  );
