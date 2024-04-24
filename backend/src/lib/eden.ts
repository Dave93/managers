import { treaty, edenFetch } from "@elysiajs/eden";
import type { App } from "@merchants/src/index";

console.log("merchant api url", process.env.MERCHANT_TRPC_API_URL);
// @ts-ignore
export const merchantApiClient = treaty<App>(
  process.env.MERCHANT_TRPC_API_URL!
);
