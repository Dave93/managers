import { defineConfig } from "vite";

// @types/node в проекте нет (у vite это необязательная зависимость), а tsc
// проверяет и этот файл.
declare const process: { env: Record<string, string | undefined> };

// СБОРКА (как у passport_miniapp: `node` по умолчанию на сервере 16, vite 7
// его не принимает, поэтому bun сам запускает vite):
//
//     cd /home/davr/managers/kpi_miniapp
//     /root/.bun/bin/bun install
//     /root/.bun/bin/bun --bun run build
//
// Отдаётся nginx с https://api.office.lesailes.uz/kpi-app/ — тот же origin, что
// и API, поэтому все вызовы /api/... — обычный fetch без CORS.
//
// `base` важен дважды: он переписывает URL ресурсов в index.html на
// /kpi-app/assets/..., и из-за него пути API в src/api.ts абсолютные: путь
// "api/kpi/tg/auth" без ведущего слэша ушёл бы на /kpi-app/api/... -> 404.
//
// Конфиг — функция от { command }: константа __KPI_DEV__ истинна только под
// `vite serve`. `import.meta.env.DEV` для этого не годится: при NODE_ENV=
// development в оболочке она станет true и в `vite build`.
export default defineConfig(({ command }) => ({
  base: "/kpi-app/",
  define: { __KPI_DEV__: JSON.stringify(command === "serve") },
  server: {
    port: 5174,
    // 6761 — порт dev-backend в этом репозитории; стенд всегда задаёт KPI_DEV_API.
    proxy: { "/api": process.env.KPI_DEV_API ?? "http://localhost:6761" },
  },
  build: {
    // Сотрудники на Android среднего класса, WebView в Telegram старый.
    // es2018 даёт async/await без раздутого regenerator.
    target: "es2018",
    // target не задаёт CSS нижней границы браузеров: без cssTarget esbuild сворачивает
    // top/right/bottom/left в `inset`, а его нет до Chrome 87 и Safari 14.1. Граница та же,
    // что у бандла: Chrome 64 и Safari 11.1 (kpi-deploy.md, «Требования к клиенту»).
    cssTarget: ["chrome64", "safari11"],
    sourcemap: false,
    // Один CSS и один JS: меньше обращений по филиальному wifi, который рвётся.
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
  },
}));
