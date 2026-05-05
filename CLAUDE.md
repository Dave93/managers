# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-service monorepo for a restaurant/franchise management system (Les Ailes / Chopar). Five independent services share types via TypeScript path aliases at the repo root:

- `admin/` — Next.js 15 + React 19 admin dashboard (Bun runtime, port 6762)
- `backend/` — Elysia API on Bun, PostgreSQL via Drizzle, Redis-backed sessions (default port 3000 via `PORT` env)
- `cron/` — Bun + node-cron scheduler for iiko sync, OLAP backfill, role assignment (port 8080)
- `duck_api/` — Hono + DuckDB data-warehouse sync service (Node, built via `tsc`)
- `merchants_api/` — Elysia service that scrapes payment-gateway reports (Payme, Click, Yandex, Express, iiko cashier) via Puppeteer

The admin frontend imports the backend's `App` type for end-to-end typed Eden client calls. Cross-service imports use the path aliases below — `admin/` and `backend/` are intentionally NOT separate npm workspaces.

## Development Commands

### All services in parallel
```bash
pnpm run --parallel dev      # from repo root; runs each subdir's `dev` script
```

### Per service
```bash
# admin (Next.js, port 6762)
cd admin && bun dev          # also: bun build, bun start, bun lint

# backend (Elysia, port from $PORT or 3000)
cd backend && bun run --watch src/index.ts

# cron (port 8080)
cd cron && bun run --watch src/index.ts -p 8080

# duck_api (Node + tsx in dev; tsc-built dist/index.js in prod)
cd duck_api && npm run dev   # build: npm run build

# merchants_api
cd merchants_api && bun run --watch src/index.ts
```

### Database (Drizzle)
Schema lives at `backend/drizzle/schema.ts` (NOT under `src/`). Migrations in `backend/drizzle/migrations/`. Run from `backend/`:
```bash
drizzle-kit generate         # generate migration from schema diff
drizzle-kit migrate          # apply pending migrations
```
`drizzle.config.ts` sets `introspect.casing: "preserve"` — preserve original column casing when introspecting.

### Tests / Lint
- No project-wide test runner. Backend has a single ad-hoc script at `backend/tests/invoices.ts`; `package.json` `test` scripts are stubs. Don't claim "tests pass" without a real check.
- Lint is admin-only: `cd admin && bun lint` (ESLint + `eslint-config-next`).

### Production (PM2)
Each service ships a `pm2.config.js`. Process names: `office_api` (backend), `office_cron`, `office_duck`, `office_merchant_api`. Admin uses an env-driven name via `process.env.PM2_APP_NAME`.

## Architecture

### TypeScript path aliases (root `tsconfig.json`)
All sub-projects extend the root tsconfig and rely on these aliases — use them instead of relative `../../..` paths:
- `@backend/*` → `./backend/src/*`
- `@admin/*` → `./admin/*`
- `@components/*` → `./admin/components/*`
- `@merchants/*` → `./merchants_api/*`

The admin's Next config sets `experimental.externalDir: true` so it can compile files outside `admin/`. The Drizzle schema is imported in admin code as `backend/drizzle/schema` directly.

### Backend module pattern
Each domain lives in `backend/src/modules/<name>/` and exports an Elysia plugin from `controller.ts` (sometimes with a `dto/` sibling for typed responses). To add a new domain you MUST:
1. Create `backend/src/modules/<name>/controller.ts` exporting `export const <name>Controller = new Elysia({ name: "@api/<name>" }).use(ctx)...`
2. Register it in `backend/src/controllers.ts` by importing and calling `.use(<name>Controller)` on `apiController`. Routes won't appear otherwise.

Routes share context via `ctx` (`backend/src/context/index.ts`) which decorates each handler with `redis`, `drizzle`, `cacheController` and exposes two macros:
- `permission: "<permission.code>"` — checks the cookie session against Redis-cached permissions; returns 401/403 on failure. Resolves `user`, `role`, `terminals` into the handler.
- `userAuth: true` — same resolve, no permission check; for endpoints any logged-in user may hit (`/users/me`, `/users/my_permissions`, `/users/logout`).

### List endpoint convention
List endpoints accept `limit`, `offset`, optional `sort`, `filters`, `fields` query params (all strings). `filters` is a JSON-encoded array of `{field, operator, value}` parsed by `@backend/lib/parseFilterFields` (operators: `in`, `contains`, `gte`, `gt`, `lte`, `lt`, plus `=` default). `fields` is a comma list parsed by `@backend/lib/parseSelectFields` and supports `relation.column` syntax for joined columns. Terminal-scoping is applied automatically via the resolved `terminals` array — see `reports` controller for the canonical pattern.

### Auth flow
Cookie-based, NOT bearer JWT in headers. Login (`POST /api/users/login`) sets `sessionId` and `refreshToken` cookies; Redis stores `${PROJECT_PREFIX}user_data:<sessionId>` (cached user/role/terminals) and `${PROJECT_PREFIX}refresh_token:<refreshToken>`. Cookie domain is `localhost` in dev, `lesailes.uz` / `arryt.uz` in prod (logout writes `arryt.uz`). `getCacheControlService` is a process-wide singleton from `@backend/lib/shared-instances`.

The admin's `middleware.ts` calls `apiClient.api.users.me.get()` server-side on every non-login request and redirects to `/<locale>/login` on non-200.

### Frontend layout selection
`admin/components/layout/main-layout.tsx` does NOT switch on a role string. It renders all of `AdminLayout`, `ManagerLayout`, `PlaygroundLayout`, `SalesPlanLayout` wrapped in `<CanAccess permission="admin_layout" | "manager_layout" | "playground_layout" | "sales_plan_layout">`, plus a `NoRoleLayout` fallback when `useGetRole()` returns `null`. To add a new top-level layout, add a permission-gated `<CanAccess>` wrapper here and ensure the permission exists in the DB.

`<CanAccess permission="...">` (`admin/components/can-access.tsx`) fetches `/users/my_permissions` once via TanStack Query (`queryKey: ["my_permissions"]`) and renders children only when the permission is present. Use it for any permission-gated UI; do NOT call the API yourself.

### Eden client
`admin/utils/eden.ts` exports `apiClient = treaty<App>(process.env.TRPC_API_URL!)` where `App` comes from `../../backend/src/app.ts`. Calls look like `apiClient.api.users.me.get()` — paths mirror the Elysia route tree. The env is named `TRPC_API_URL` for historical reasons; the backend is Elysia, not tRPC.

`backend/src/lib/eden.ts` exposes `merchantApiClient` for backend → merchants_api calls.

### State / data layers (admin)
- TanStack Query for server state (`Providers` in `admin/store/provider.tsx` mounts `QueryClientProvider`)
- Zustand stores under `admin/store/states/` (e.g. `roles.ts`, `report_data.ts`)
- Redux Toolkit is in dependencies but only lightly used
- `nuqs` for URL-synced filter state

### i18n
`next-intl` with locales `en`, `ru` (default), `uz-Latn`, `uz-Cyrl`. `localePrefix: "always"` and `localeDetection: false` — every URL is `/<locale>/...`. Routing helpers come from `admin/i18n/routing.ts` (`Link`, `redirect`, `usePathname`, `useRouter`). Messages: `admin/messages/<locale>.json`. Pages live under `admin/app/[locale]/`.

## Database notes

- Schema is a single 1500+ line file at `backend/drizzle/schema.ts` — large and authoritative; grep here before assuming a column exists.
- Time-series tables (e.g. `orders`) use composite primary keys with date partitions; see `backend/drizzle/timescale_scripts.sql` for TimescaleDB hypertable setup.
- iiko terminal mapping: `terminals.iiko_id` maps an iiko terminal_id to a managers row (recent refactor — do NOT add a separate `iiko_id` column elsewhere; use the credentials/terminals tables).
- Migrations are NOT idempotent; review generated SQL before running. Several `0001_*`, `0002_*`, etc. pairs exist for the same number — the `meta/_journal.json` is the source of truth for order.

## Environment variables (non-obvious ones)

- Backend: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `SESSION_EXPIRES_IN`, `PROJECT_PREFIX` (Redis key namespace), `PORT`, `MERCHANT_TRPC_API_URL`, `ENV` (`development` toggles localhost cookie domain).
- Admin: `TRPC_API_URL` (points at backend, exposed at build time via `next.config.js`), `COOKIE_DOMAIN`.
- Duck API: `DUCK_PATH` (DuckDB file).

## Design docs

`docs/superpowers/specs/` and `docs/superpowers/plans/` contain dated design docs (e.g. `2026-04-17-playground-per-terminal-design.md`). Read the matching spec/plan pair before substantive changes to a feature documented there.
