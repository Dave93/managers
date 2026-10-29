# Manager Test-Taking Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give branch managers a tablet test-taking mode (kiosk + own-branch analytics/roster + PIN), with terminal-scoped access restored behind an explicit HQ marker.

**Architecture:** Add an `attestation.hq` permission that (with `is_super_user`) marks HQ. A `resolveIsHq` helper reads the caller's role permissions and drives terminal-scoping across attestation data endpoints. Admin UI gates the attestation sub-nav per permission and adds an "Аттестация" item to `ManagerLayout`.

**Tech Stack:** Bun · Elysia · Drizzle · Eden client · Next.js 15 / React 19 · TanStack Query · next-intl · CanAccess (permission-gated rendering).

## Global Constraints

- No DB migration — `attestation.hq` is a `permissions` row (seeded).
- HQ is explicit: `isHQ = user?.is_super_user === true || callerPerms.includes("attestation.hq")`. NEVER infer HQ from empty terminals (fail-open).
- Non-HQ callers are scoped by their `terminals` (`string[]`); a non-HQ account with 0 terminals sees nothing (safe closed default).
- `role` and `cacheController` are available in Elysia handlers (resolved by the `permission` macro / decorated on `ctx`). `cacheController.getPermissionsByRoleId(roleId: string): Promise<string[]>`.
- Backend deploy = recompile `app` binary (`bun build --compile --minify-whitespace --minify-syntax --target bun --outfile app src/index.ts`) + `pm2 restart office_api`. Admin deploy = `bun run build` + `pm2 restart office_admin` with node20 in PATH.
- `CanAccess` (`admin/components/can-access.tsx`) renders children only when the permission is present; use it to gate nav items.

---

## File Structure

- `backend/src/modules/attestation/seed-permissions.ts` (modify) — add `attestation.hq`.
- `backend/src/modules/attestation/controller.ts` (modify) — add `resolveIsHq` helper; re-scope employees list/one, analytics attempts/summary, reset; align kiosk start/submit to `isHQ`.
- `admin/components/layout/attestation-layout.tsx` (modify) — per-item permission gating of the sub-nav.
- `admin/components/layout/manager-layout.tsx` (modify) — add gated "Аттестация" bottom-nav item.

---

## Task 1: Seed the `attestation.hq` permission

**Files:**
- Modify: `backend/src/modules/attestation/seed-permissions.ts`

**Interfaces:**
- Produces: a `permissions` row with slug `attestation.hq`.

- [ ] **Step 1: Add the slug to the seeder list**

In `backend/src/modules/attestation/seed-permissions.ts`, add to the `SLUGS` array (after `attestation.analytics`):

```ts
  { slug: "attestation.hq", description: "Attestation: HQ / cross-branch access" },
```

- [ ] **Step 2: Run the seeder locally**

Run from `backend/`: `bun run src/modules/attestation/seed-permissions.ts`
Expected: prints `inserted attestation.hq` the first run, `skip attestation.hq (exists)` thereafter.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/attestation/seed-permissions.ts
git commit -m "feat(attestation): seed attestation.hq permission"
```

---

## Task 2: `resolveIsHq` helper + re-scope backend endpoints

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Produces: `async function resolveIsHq(args: { user, role, cacheController }): Promise<boolean>`.
- Consumes: `cacheController.getPermissionsByRoleId(role.id)`.

- [ ] **Step 1: Add the helper**

Near the top of `controller.ts` (after the `pinFailKey` helper), add:

```ts
// Explicit HQ marker — super-user, or the caller's role holds attestation.hq.
// Never inferred from empty terminal scope (that would be fail-open).
async function resolveIsHq(args: {
  user: { is_super_user?: boolean | null } | null;
  role: { id: string } | null;
  cacheController: { getPermissionsByRoleId: (roleId: string) => Promise<string[]> };
}): Promise<boolean> {
  if (args.user?.is_super_user === true) return true;
  if (!args.role) return false;
  const perms = await args.cacheController.getPermissionsByRoleId(args.role.id);
  return perms.includes("attestation.hq");
}
```

- [ ] **Step 2: Re-scope `GET /attestation/employees` (list)**

Replace the current unscoped list handler body:

```ts
    async ({ query: { limit, offset }, user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const scope = isHQ ? [] : [inArray(employees.terminal_id, terminals)];
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(employees)
        .where(and(...scope))
        .execute();
      const rows = await drizzle
        .select()
        .from(employees)
        .where(and(...scope))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: count[0].count, data: rows.map(stripPin) };
    },
```

- [ ] **Step 3: Re-scope `GET /attestation/employees/:id`**

Replace its handler body:

```ts
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const rows = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!rows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = rows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      return stripPin(emp);
    },
```

- [ ] **Step 4: Re-scope employees POST/PUT/DELETE (defense in depth)**

POST `/attestation/employees` handler:

```ts
    async ({ body: { data }, user, role, terminals, cacheController, set, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(data.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const inserted = await drizzle
        .insert(employees)
        .values(data)
        .returning({ id: employees.id })
        .execute();
      return { data: inserted[0] };
    },
```

PUT `/attestation/employees/:id` handler:

```ts
    async ({ params: { id }, body: { data }, user, role, terminals, cacheController, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(current[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      if (!isHQ && data.terminal_id != null && data.terminal_id !== current[0].terminal_id) {
        set.status = 403;
        return { message: "Cross-terminal transfer requires HQ" };
      }
      const updated = await drizzle
        .update(employees)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return updated[0];
    },
```

DELETE `/attestation/employees/:id` handler:

```ts
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(current[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const deleted = await drizzle
        .delete(employees)
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return deleted[0];
    },
```

- [ ] **Step 5: Align kiosk start/submit to `isHQ`**

In `POST /attestation/attempts/start`, change the handler destructure to include `role, cacheController` and replace `const isHQ = user?.is_super_user === true;` with:

```ts
      const isHQ = await resolveIsHq({ user, role, cacheController });
```
(The existing `if (!isHQ && !terminals.includes(emp.terminal_id))` check stays.)

In `POST /attestation/attempts/:id/submit`, same: add `role, cacheController` to destructure, replace the `isHQ` line with the `resolveIsHq` call. Existing scope check stays.

- [ ] **Step 6: Re-scope analytics + reset**

`GET /attestation/analytics/attempts`:

```ts
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) where.push(inArray(attestation_test_attempts.terminal_id, terminals));
      if (query.terminal_id) where.push(eq(attestation_test_attempts.terminal_id, query.terminal_id));
      if (query.test_id) where.push(eq(attestation_test_attempts.test_id, query.test_id));
      if (query.passed != null) where.push(eq(attestation_test_attempts.passed, query.passed === "true"));
      // ... unchanged select/join/limit/offset ...
```

`GET /attestation/analytics/summary`:

```ts
    async ({ user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const scope = isHQ ? [] : [inArray(attestation_test_attempts.terminal_id, terminals)];
      const soonIso = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      const nowIso = new Date().toISOString();
      const agg = await drizzle
        .select({ /* unchanged */ })
        .from(attestation_test_attempts)
        .where(and(...scope))
        .execute();
      // ... unchanged ...
```

`POST /attestation/attempts/:id/reset`:

```ts
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const rows = await drizzle
        .select({ terminal_id: attestation_test_attempts.terminal_id })
        .from(attestation_test_attempts)
        .where(eq(attestation_test_attempts.id, id))
        .execute();
      if (!rows.length) {
        set.status = 404;
        return { message: "Attempt not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(rows[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const updated = await drizzle
        .update(attestation_test_attempts)
        .set({ status: "expired" })
        .where(eq(attestation_test_attempts.id, id))
        .returning({ id: attestation_test_attempts.id })
        .execute();
      return updated[0];
    },
```

- [ ] **Step 7: Typecheck**

Run from `backend/`: `bunx tsc --noEmit 2>&1 | grep "modules/attestation" | grep "error TS"`
Expected: no output (clean). Fix any unused `terminals` destructure warnings by keeping `terminals` (it is used in every scoped handler).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "security(attestation): explicit-HQ terminal scoping via attestation.hq"
```

---

## Task 3: Gate the attestation sub-nav per permission

**Files:**
- Modify: `admin/components/layout/attestation-layout.tsx`

**Interfaces:**
- Consumes: `CanAccess` (`@admin/components/can-access`).

- [ ] **Step 1: Wrap each nav link in CanAccess**

Rewrite `attestation-layout.tsx` so each nav item carries a `permission` and renders inside `<CanAccess>`:

```tsx
"use client";
import React from "react";
import { useTranslations } from "next-intl";
import { Link } from "@admin/i18n/routing";
import { GraduationCap, Users, BarChart3, MonitorPlay, KeyRound } from "lucide-react";
import CanAccess from "@admin/components/can-access";

export default function AttestationLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("attestation.nav");

  const navItems = [
    { href: "/attestation/tests", label: t("tests"), icon: GraduationCap, permission: "tests.list" },
    { href: "/attestation/employees", label: t("employees"), icon: Users, permission: "employees.list" },
    { href: "/attestation/analytics", label: t("analytics"), icon: BarChart3, permission: "attestation.analytics" },
    { href: "/attestation/kiosk", label: t("kiosk"), icon: MonitorPlay, permission: "attestation.run" },
    { href: "/attestation/pin", label: t("pin"), icon: KeyRound, permission: "attestation_layout" },
  ];

  return (
    <div className="md:container">
      <nav className="flex flex-wrap gap-1 border-b py-3 mb-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <CanAccess key={item.href} permission={item.permission}>
              <Link
                href={item.href}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            </CanAccess>
          );
        })}
      </nav>
      <div className="pb-16">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run from `admin/`: `bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add admin/components/layout/attestation-layout.tsx
git commit -m "feat(attestation): gate sub-nav items by permission"
```

---

## Task 4: Add "Аттестация" to ManagerLayout bottom nav

**Files:**
- Modify: `admin/components/layout/manager-layout.tsx`

**Interfaces:**
- Consumes: `CanAccess`.

- [ ] **Step 1: Add the gated nav item**

`manager-layout.tsx` renders a fixed bottom bar with `<Link>` items (Главная / Отчеты / Asrabox / Settings / Profile) using `next/link`. Add a 6th item before the Profile link, gated by `attestation.run`. Add the import at the top:

```tsx
import CanAccess from "@admin/components/can-access";
```

Then insert, immediately before the Profile `<Link>` block:

```tsx
          <CanAccess permission="attestation.run">
            <Link
              href="/attestation/kiosk"
              type="button"
              className="inline-flex flex-col items-center justify-center px-5 hover:bg-gray-50 dark:hover:bg-gray-800 group"
            >
              <svg
                className="w-5 h-5 mb-2 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.42A12 12 0 0112 21a12 12 0 01-6.16-10.42L12 14z" />
              </svg>
              <span className="text-sm text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500">
                Аттестация
              </span>
            </Link>
          </CanAccess>
```

Note: the bottom bar uses `grid-cols-5`; update the grid to `grid-cols-6` on the container `<div className="grid h-full max-w-lg grid-cols-5 ...">` so 6 items lay out evenly. Change `grid-cols-5` → `grid-cols-6`.

- [ ] **Step 2: Typecheck**

Run from `admin/`: `bunx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
git add admin/components/layout/manager-layout.tsx
git commit -m "feat(attestation): add Аттестация to manager tablet bottom nav"
```

---

## Task 5: Local verification (chrome-attach)

**Files:** none (verification only).

- [ ] **Step 1: Apply seed + restart local backend**

Run seeder against local DB (Task 1 Step 2 already inserts it). Restart `bun run --watch src/index.ts` picks up controller changes automatically.

- [ ] **Step 2: Central account sees all**

As the local `admin` account: grant it `attestation.hq` via SQL, or rely on it holding the permission through its role. Visit `/ru/attestation/employees` → all 390 (local: the seeded count) visible; `/ru/attestation/analytics` → all rows.

Grant SQL (local):
```sql
INSERT INTO roles_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE code='admin'),
       (SELECT id FROM permissions WHERE slug='attestation.hq')
WHERE NOT EXISTS (SELECT 1 FROM roles_permissions rp
  JOIN permissions p ON p.id=rp.permission_id
  WHERE rp.role_id=(SELECT id FROM roles WHERE code='admin') AND p.slug='attestation.hq');
```

- [ ] **Step 3: Manager-scoped account sees only its branch**

Create/pick a non-super account with a role holding `manager_layout, attestation_layout, attestation.run, employees.list, employees.one, attestation.analytics` (no `attestation.hq`, no `tests.*`) and one terminal assigned. Log in on the tablet layout:
- Bottom nav shows "Аттестация".
- Sub-nav shows Сотрудники / Аналитика / Пройти тест / Мой PIN (no Тесты).
- Employees list shows only that terminal's employees; analytics only that branch.

- [ ] **Step 4: Confirm no fail-open**

A non-super account with 0 terminals and no `attestation.hq` visiting `/attestation/employees` → empty list (not all), no 500.

---

## Task 6: Deploy to prod

**Files:** none (deploy only).

- [ ] **Step 1: Bundle backend + admin commits, merge on prod**

Cherry-pick the backend controller + seeder commits onto a clean base prod has; bundle admin commits separately (main-nav on prod is refactored — attestation-layout/manager-layout do not conflict). scp bundles, fetch + merge on prod. Resolve any conflict by keeping prod's version for files prod refactored.

- [ ] **Step 2: Seed `attestation.hq` on prod**

Run on prod from `backend/`: `bun run src/modules/attestation/seed-permissions.ts` → inserts `attestation.hq`.

- [ ] **Step 3: Grant `attestation.hq` to the central role(s)**

On prod DB, insert `roles_permissions` linking the central admin role (and the owner's account role) to `attestation.hq` (idempotent, same SQL shape as Task 5 Step 2). Otherwise 0-terminal central accounts see nothing after re-scoping.

- [ ] **Step 4: Rebuild backend binary + restart**

On prod `backend/`: `bun build --compile --minify-whitespace --minify-syntax --target bun --outfile app.new src/index.ts` → swap `app` → `pm2 restart office_api`. Verify `GET /api/attestation/tests?limit=1&offset=0` → 401; wait for `🦊 Elysia` + port 6761.

- [ ] **Step 5: Rebuild admin + restart**

On prod `admin/` with node20 in PATH: `bun run build` → `pm2 restart office_admin --update-env` → `pm2 save`. Verify `/ru/login` → 200.

- [ ] **Step 6: Smoke**

Owner account refreshes `/ru/attestation/employees` → sees all (now via `attestation.hq`). Confirm a scoped manager account (if available) sees only its branch.

---

## Self-Review Notes

- **Spec coverage:** access model / explicit HQ (T1 seed, T2 helper+scoping) ✓; re-scope employees + analytics + reset + kiosk (T2) ✓; sub-nav gating (T3) ✓; ManagerLayout item (T4) ✓; role recipes (T5/T6 grants + docs) ✓; deploy + grant hq (T6) ✓; no-fail-open closed default (T2, T5 Step 4) ✓.
- **No schema migration** — `attestation.hq` is a seeded row ✓.
- **Type consistency:** `resolveIsHq({ user, role, cacheController })` signature identical across all call sites; `getPermissionsByRoleId` returns `string[]`.
- **Known follow-up:** local/prod `main-nav.tsx` diverged earlier (prod refactored, not pushed to origin); unrelated to this plan but reconcile when convenient.
