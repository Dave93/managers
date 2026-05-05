import { treaty, edenFetch } from "@elysiajs/eden";
import type { App } from "../../backend/src/app";

console.log("process.env.APP_API_URL", process.env.TRPC_API_URL);
// In the browser, hit the same origin and let Next.js rewrites proxy /api/*
// to the backend — keeps cookies host-only and makes the app work behind
// any tunnel host (ngrok, localtunnel, etc.). On the server we still need an
// absolute URL because middleware.ts runs server-side fetch.
const apiBaseUrl =
  typeof window !== "undefined"
    ? window.location.origin
    : process.env.TRPC_API_URL!;
//@ts-ignore
export const apiClient = treaty<App>(apiBaseUrl, {
  fetch: {
    credentials: "include",
  },
});
//@ts-ignore
export const apiFetch = edenFetch<App>(process.env.TRPC_API_URL!);
