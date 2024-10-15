import { treaty, edenFetch } from "@elysiajs/eden";
import type { App } from "@backend/app";

console.log("process.env.APP_API_URL", process.env.TRPC_API_URL);
//@ts-ignore
export const apiClient = treaty<App>(process.env.TRPC_API_URL!, {
  fetch: {
    credentials: "include",
  },
});
//@ts-ignore
export const apiFetch = edenFetch<App>(process.env.TRPC_API_URL!);
