import { treaty, edenFetch } from "@elysiajs/eden";
import type { App } from "@backend/app";

console.log("process.env.APP_API_URL", process.env.TRPC_API_URL);
export const apiClient = treaty<App>(process.env.TRPC_API_URL!, {
  credentials: "include",
});
export const apiFetch = edenFetch<App>(process.env.TRPC_API_URL!);
