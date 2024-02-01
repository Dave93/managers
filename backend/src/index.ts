import { Elysia } from "elysia";
import { apiController } from "./controllers";

const app = new Elysia()
  .get("/", () => ({ hello: "world" }))
  .use(apiController)
  .listen(process.env.PORT || 3000);

export type App = typeof app;

app.onStop(() => {
  console.log("🦊 Elysia is stopping...");
});

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
