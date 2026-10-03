import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import { getProductLinksMeta, getTerminalProductIds } from "./service";

export const productLinksController = new Elysia({
  name: "@api/product_links",
})
  .use(ctx)
  .get(
    "/api/product_links/terminal/:terminalId",
    async ({ params, drizzle, redis, terminals, set }) => {
      const userTerminals = (terminals ?? []) as string[];
      if (!userTerminals.includes(params.terminalId)) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const [product_ids, meta] = await Promise.all([
        getTerminalProductIds(redis, drizzle, params.terminalId),
        getProductLinksMeta(drizzle),
      ]);
      return {
        version: meta?.version ?? null,
        synced_at: meta?.synced_at ?? null,
        product_ids,
      };
    },
    {
      userAuth: true,
      params: t.Object({ terminalId: t.String({ format: "uuid" }) }),
    }
  );
