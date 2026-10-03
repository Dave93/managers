import { ctx } from "@backend/context";
import Elysia, { t } from "elysia";
import {
  getProductLinksMeta,
  getStoreProductIds,
  getTerminalProducts,
  getTerminalStoreIds,
} from "./service";

const uuidParam = (name: string) =>
  t.Object({ [name]: t.String({ format: "uuid" }) });

export const productLinksController = new Elysia({
  name: "@api/product_links",
})
  .use(ctx)
  // Products for one of the caller's terminals (union over its warehouses).
  .get(
    "/api/product_links/terminal/:terminalId",
    async ({ params, drizzle, redis, terminals, set }) => {
      if (!((terminals ?? []) as string[]).includes(params.terminalId)) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const [links, meta] = await Promise.all([
        getTerminalProducts(redis, drizzle, params.terminalId),
        getProductLinksMeta(drizzle),
      ]);
      return {
        version: meta?.version ?? null,
        synced_at: meta?.synced_at ?? null,
        store_ids: links?.store_ids ?? [],
        product_ids: links?.product_ids ?? null,
      };
    },
    { userAuth: true, params: uuidParam("terminalId") }
  )
  // Products for a warehouse; the warehouse must belong to one of the
  // caller's terminals.
  .get(
    "/api/product_links/store/:storeId",
    async ({ params, drizzle, redis, terminals, set }) => {
      const storeId = params.storeId.toLowerCase();
      const own = await getTerminalStoreIds(drizzle, (terminals ?? []) as string[]);
      if (!own.includes(storeId)) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const [product_ids, meta] = await Promise.all([
        getStoreProductIds(redis, drizzle, storeId),
        getProductLinksMeta(drizzle),
      ]);
      return {
        version: meta?.version ?? null,
        synced_at: meta?.synced_at ?? null,
        product_ids,
      };
    },
    { userAuth: true, params: uuidParam("storeId") }
  );
