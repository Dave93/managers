import type { Router } from "@merchants/src";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

export const merchantTrpcClient = createTRPCProxyClient<Router>({
  links: [
    httpBatchLink({
      url: `${process.env.MERCHANT_TRPC_API_URL}/trpc`, // you should update this to use env variables
    }),
  ],
});
