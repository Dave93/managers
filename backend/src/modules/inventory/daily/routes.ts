// «Дневные остатки» — кто из складов филиалов вбивает пересчёт за каждый день. Только офис
// (inventory.templates, как «Остатки склада»). Плагин без префикса: подключается внутри
// inventoryControllerImpl (/api).
import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { run } from "../errors";
import { loadDailyGrid } from "./read";

export const dailyRoutes = new Elysia({ name: "@api/inventory/daily" })
  .use(ctx)
  .get(
    "/inventory/daily-grid",
    async ({ query, drizzle, set }) => run(set, async () => loadDailyGrid(drizzle, query.period, new Date())),
    { permission: "inventory.templates", query: t.Object({ period: t.String() }) }
  );
