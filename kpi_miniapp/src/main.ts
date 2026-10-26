// Временный вход каркаса: вход по initData и JSON главного экрана в <pre>.
// Заменяется в задаче 4.
import type { TgHome } from "@backend/modules/kpi/tg-app/types";
import { appApi } from "./api";
import { parseHash } from "./route";
import { applyTheme, webApp } from "./telegram";

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;
  const w = webApp();
  w?.ready?.();
  w?.expand?.();
  applyTheme();
  const pre = document.createElement("pre");
  const r = await appApi().get<TgHome>("/home");
  pre.textContent = JSON.stringify({ route: parseHash(location.hash), result: r }, null, 2);
  app.replaceChildren(pre);
}

void boot();
