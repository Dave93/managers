// Временный вход каркаса: вход по initData и JSON главного экрана в <pre>.
// Заменяется в задаче 4.
import type { TgHome } from "@backend/modules/kpi/tg-app/types";
import { appApi } from "./api";
import { devRequested } from "./dev/flag";
import { parseHash } from "./route";
import { applyTheme, webApp } from "./telegram";

// Константа сборки из vite.config.ts (решение 1): true только под `vite serve`.
declare const __KPI_DEV__: boolean;

async function boot(): Promise<void> {
  // Dev-режим: поддельный Telegram в обычном Chrome. В сборке ветка мёртвая, и модуль подделки
  // в бандл не попадает: он подключается только здесь и только через import().
  if (__KPI_DEV__ && devRequested(location.search)) (await import("./dev/fake-telegram")).installFakeTelegram(location.search);
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
