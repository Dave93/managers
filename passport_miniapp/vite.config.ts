import { defineConfig } from "vite";

// BUILD COMMAND (matters — the box's default `node` is 16 and Vite 7 refuses
// it, with a misleading "crypto.getRandomValues is not a function"):
//
//     cd /home/davr/managers/passport_miniapp
//     /root/.bun/bin/bun install
//     /root/.bun/bin/bun --bun run build
//
// `--bun` makes bun itself execute the vite binary instead of handing it to
// node. Neither `bun` nor `bunx` is on the default PATH, so the package.json
// script cannot call them by name — the flag has to come from the caller.
// Node 20.20.2 at /root/.nvm/versions/node/v20.20.2/bin also works.
//
// Served by nginx from https://api.office.lesailes.uz/passport-app/ (Task C5),
// SAME ORIGIN as the API, which is why every /api/... call is a plain relative
// fetch with no CORS and no configured host.
//
// `base` is load bearing twice over: it rewrites the asset URLs inside
// index.html to /passport-app/assets/..., and it is the reason API paths in
// src/api.ts start with a leading slash. A relative "api/passport/tg/auth"
// would resolve against the base and hit /passport-app/api/... -> 404.
export default defineConfig({
  base: "/passport-app/",
  build: {
    // Line staff on mid-range Androids; Telegram's WebView there is old
    // Chromium. es2018 covers async/await natively without regenerator bloat.
    target: "es2018",
    sourcemap: false,
    // One CSS file, one JS file: fewer round trips on branch wifi that drops.
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
  },
});
