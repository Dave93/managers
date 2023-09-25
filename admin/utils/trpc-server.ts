import type { Router } from "@backend/_routes";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
console.log("trpc-client", `${process.env.TRPC_API_URL}/trpc`);
export const trpcClient = createTRPCProxyClient<Router>({
  links: [
    httpBatchLink({
      url: `${process.env.TRPC_API_URL}/trpc`, // you should update this to use env variables
    }),
  ],
});
