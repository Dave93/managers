import { edenTreaty, edenFetch } from "@elysiajs/eden";
import type { App } from "@merchants/src/index";

console.log('merchant api url', process.env.MERCHANT_TRPC_API_URL)

export const merchantApiClient = edenTreaty<App>(process.env.MERCHANT_TRPC_API_URL!);


