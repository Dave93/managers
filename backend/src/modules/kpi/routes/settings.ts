import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { actorFrom, requireAny } from "../access";
import { run } from "../errors";
import { loadSettings, saveSettings } from "../settings";

export const settingsRoutes = new Elysia({ name: "@api/kpi/settings" })
  .use(ctx)
  .get(
    "/kpi/settings",
    async ({ user, role, terminals, drizzle, cacheController, set }) =>
      run(set, async () => {
        const actor = await actorFrom({ user, role, terminals, cacheController });
        requireAny(actor, ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"]);
        return loadSettings(drizzle);
      }),
    { userAuth: true }
  )
  .put(
    "/kpi/settings",
    async ({ body, user, drizzle, set }) =>
      run(set, async () =>
        // Неизвестные ключи отсекает validateSettingsPatch → 422 unknown_setting.
        drizzle.transaction((tx) => saveSettings(tx, body as Record<string, never>, user!.id))
      ),
    { permission: "kpi.manage", body: t.Record(t.String(), t.Any()) }
  );
