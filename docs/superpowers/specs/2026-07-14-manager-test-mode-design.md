# Manager Test-Taking Mode (Tablet) — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Depends on:** employee-attestation feature (already shipped)

## Problem

Branch tablets run the `ManagerLayout` (bottom nav: Главная / Отчеты / Asrabox / Settings / Profile). Branch managers need, on that tablet, a **test-taking mode**: launch attestation tests for their employees, see their own branch's results and roster, and manage their launch PIN — all scoped to their branch. Central admins keep full cross-branch management.

The current access model (after the fail-open security fix) leaves `employees.*` and analytics **unscoped** — any permission holder sees all branches. That is wrong for branch managers, who must see only their own branch. This design restores terminal-scoping with an **explicit** HQ signal (no fail-open).

## Goals

1. Branch manager on the tablet: launch tests (kiosk), view own-branch analytics, view own-branch employee roster (read-only), set own launch PIN.
2. Everything the manager sees is auto-scoped to their branch (their `users_terminals`).
3. Central admins keep cross-branch access, determined by an explicit HQ marker — not by absence of scope.

## Non-goals

- Manager does NOT author tests/questions (`tests.*` stays central).
- Manager does NOT add/edit/delete employees (roster CRUD stays central); read-only for managers.
- Manager does NOT reset attempts (`attestation.reset` stays central).
- No schema/DB migration (the new HQ marker is a permission row).

## Access model (the core change)

Replace the current unscoped-central logic with explicit-HQ + terminal scoping.

- **New permission slug: `attestation.hq`.** Granted to central admin roles. NOT granted to branch managers.
- **HQ resolution:** `isHQ = user.is_super_user === true || callerPermissions.includes("attestation.hq")`.
  - `callerPermissions` is fetched once per request via `cacheController.getPermissionsByRoleId(role.id)` (a helper `resolveIsHq({ user, role, cacheController })`). `role` is resolved by the `permission` macro; `cacheController` is decorated on the context.
- **Scoping rule** applied on all data endpoints: `isHQ ? (no filter) : filter by inArray(<terminal_col>, terminals)`.
  - A non-HQ account with 0 terminals matches nothing → sees nothing. This is a safe closed default (deprovisioning ≠ escalation), NOT fail-open.
- **Endpoints re-scoped** (revert the "unscoped central" change, gate by `isHQ`):
  - `GET /attestation/employees` (list) — scope by `employees.terminal_id`.
  - `GET /attestation/employees/:id` — 403 when `!isHQ && !terminals.includes(emp.terminal_id)`.
  - `GET /attestation/analytics/attempts` — scope by `attestation_test_attempts.terminal_id`.
  - `GET /attestation/analytics/summary` — same.
  - `POST /attestation/attempts/:id/reset` — 403 when out of scope (managers won't hold `attestation.reset` anyway; defense in depth).
- **Endpoints already scoped** (align `is_super_user` → `isHQ`):
  - `POST /attestation/attempts/start` — employee must be in scope; `isHQ` bypass.
  - `POST /attestation/attempts/:id/submit` — attempt terminal in scope; `isHQ` bypass.
- **employees add/edit/delete:** keep scoped too (`isHQ` bypass) as defense in depth, even though managers lack these permissions.

**Helper signature:**
```ts
async function resolveIsHq(ctx: {
  user: { id: string; is_super_user?: boolean } | null;
  role: { id: string } | null;
  cacheController: { getPermissionsByRoleId(roleId: string): Promise<string[]> };
}): Promise<boolean>
```
Returns `true` if `user?.is_super_user === true`, else if `role` present and its permissions include `"attestation.hq"`, else `false`.

## Manager tablet UI

### ManagerLayout bottom nav
Add a 6th item to `admin/components/layout/manager-layout.tsx`:
- Label "Аттестация", icon (graduation cap), `href="/attestation/kiosk"`.
- Gated with `<CanAccess permission="attestation.run">` so only attestation-enabled branch accounts see it.
- Uses the i18n `Link` from `@admin/i18n/routing` (locale-prefixed) — matching the existing manager-layout link style, but that file currently uses plain `next/link` with hardcoded `/` hrefs; add the new item consistent with the file's existing pattern (plain `Link` + the locale is already in the URL because navigation happens within `/<locale>/...`). Follow whatever the existing items do.

### AttestationLayout sub-nav gating
`admin/components/layout/attestation-layout.tsx` currently renders all 5 sub-nav links unconditionally. Gate each by permission so managers see only their subset:
- Тесты → `tests.list`
- Сотрудники → `employees.list`
- Аналитика → `attestation.analytics`
- Пройти тест → `attestation.run`
- Мой PIN → `attestation_layout`

Wrap each nav link in `<CanAccess permission="...">`. Manager (holding `employees.list`, `attestation.analytics`, `attestation.run`, `attestation_layout`, but NOT `tests.*`) sees: **Сотрудники / Аналитика / Пройти тест / Мой PIN**. Central admin (all perms) sees everything including Тесты.

All manager-visible pages (employees list, analytics) are auto-scoped server-side to the manager's terminals (manager is not HQ).

## Role recipes (operational)

- **Branch manager (tablet):** `manager_layout`, `attestation_layout`, `attestation.run`, `employees.list`, `employees.one`, `attestation.analytics`; account assigned its terminal(s) via `users_terminals`.
- **Central test admin:** `admin_layout`, `attestation_layout`, `attestation.hq`, `tests.list/one/add/edit/delete`, `employees.list/one/add/edit/delete`, `attestation.analytics`, `attestation.reset`.

## Deploy notes

- Backend: seed the `attestation.hq` permission slug (add to `seed-permissions.ts` list); add the `resolveIsHq` helper + re-scope endpoints. No DB migration. Recompile the `app` binary, restart `office_api`.
- Admin: manager-layout item + attestation-layout gating. Rebuild (`bun run build`), restart `office_admin` (node20).
- **Grant `attestation.hq`** to the central admin role(s) on prod (including the owner's account role) — otherwise central accounts with 0 terminals see nothing after re-scoping.

## Testing (local)

1. Central account with `attestation.hq` → sees all 390 employees + all analytics.
2. Manager account (terminal assigned, no `attestation.hq`) → sees only own-branch employees + analytics; kiosk lists only own-branch employees; can set PIN and launch a test.
3. Manager account with 0 terminals and no HQ → sees nothing (closed default), no error.
4. ManagerLayout shows "Аттестация" only when the account holds `attestation.run`.
5. Sub-nav shows only the permitted items for the manager.

## Open items for the plan

- Confirm `role` and `cacheController` are destructurable in the handler context; if `role` is not directly available, resolve it the same way the `permission` macro does.
- Exact icon + placement of the ManagerLayout item.
