# Admin-Managed Manager PINs Implementation Plan

> Use superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Central admins set/reset branch-manager launch PINs from a "PIN менеджеров" page (accounts holding `attestation.run` only).

**Tech Stack:** Elysia · Drizzle · Bun.password · Next.js · TanStack Query · next-intl · CanAccess.

## Global Constraints

- No DB migration (`users.attestation_pin_hash` exists).
- All new endpoints gated `permission: "attestation.manage_pins"`.
- Only users whose role holds `attestation.run` are listable/settable; membership re-checked on write.
- Never return the PIN hash.

---

## Task 1: Seed `attestation.manage_pins`

- [ ] Add to `backend/src/modules/attestation/seed-permissions.ts` SLUGS: `{ slug: "attestation.manage_pins", description: "Attestation: set/reset manager PINs" }`. Run seeder locally. Commit.

---

## Task 2: Backend endpoints

**Files:** `backend/src/modules/attestation/controller.ts` (add `roles_permissions`, `permissions` to schema import).

- [ ] **Step 1: Add a helper to fetch attestation.run role ids**

```ts
async function attestationRunRoleIds(drizzle: any): Promise<string[]> {
  const rows = await drizzle
    .select({ role_id: roles_permissions.role_id })
    .from(roles_permissions)
    .innerJoin(permissions, eq(permissions.id, roles_permissions.permission_id))
    .where(eq(permissions.slug, "attestation.run"))
    .execute();
  return [...new Set(rows.map((r: any) => r.role_id).filter(Boolean))];
}
```

- [ ] **Step 2: GET list**

```ts
  .get(
    "/attestation/manager-pins",
    async ({ query: { limit, offset, search }, drizzle }) => {
      const roleIds = await attestationRunRoleIds(drizzle);
      if (!roleIds.length) return { total: 0, data: [] };
      const where: (SQLWrapper | undefined)[] = [inArray(users.role_id, roleIds)];
      if (search)
        where.push(
          or(
            ilike(users.login, `%${search}%`),
            ilike(users.first_name, `%${search}%`),
            ilike(users.last_name, `%${search}%`)
          )
        );
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(...where))
        .execute();
      const rows = await drizzle
        .select({
          id: users.id,
          login: users.login,
          first_name: users.first_name,
          last_name: users.last_name,
          has_pin: sql<boolean>`${users.attestation_pin_hash} is not null`,
        })
        .from(users)
        .where(and(...where))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: count[0].count, data: rows };
    },
    {
      permission: "attestation.manage_pins",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        search: t.Optional(t.String()),
      }),
    }
  )
```

- [ ] **Step 3: POST set + DELETE clear** (membership-checked)

```ts
  .post(
    "/attestation/manager-pins/:userId",
    async ({ params: { userId }, body: { data }, set, drizzle }) => {
      if (!/^\d{4,6}$/.test(data.pin)) {
        set.status = 400;
        return { message: "PIN must be 4-6 digits" };
      }
      const roleIds = await attestationRunRoleIds(drizzle);
      const u = await drizzle
        .select({ id: users.id, role_id: users.role_id })
        .from(users)
        .where(eq(users.id, userId))
        .execute();
      if (!u.length || !u[0].role_id || !roleIds.includes(u[0].role_id)) {
        set.status = 404;
        return { message: "Manager account not found" };
      }
      await drizzle
        .update(users)
        .set({ attestation_pin_hash: await Bun.password.hash(data.pin) })
        .where(eq(users.id, userId))
        .execute();
      return { ok: true };
    },
    {
      permission: "attestation.manage_pins",
      params: t.Object({ userId: t.String() }),
      body: t.Object({ data: t.Object({ pin: t.String() }) }),
    }
  )
  .delete(
    "/attestation/manager-pins/:userId",
    async ({ params: { userId }, set, drizzle }) => {
      const roleIds = await attestationRunRoleIds(drizzle);
      const u = await drizzle
        .select({ id: users.id, role_id: users.role_id })
        .from(users)
        .where(eq(users.id, userId))
        .execute();
      if (!u.length || !u[0].role_id || !roleIds.includes(u[0].role_id)) {
        set.status = 404;
        return { message: "Manager account not found" };
      }
      await drizzle
        .update(users)
        .set({ attestation_pin_hash: null })
        .where(eq(users.id, userId))
        .execute();
      return { ok: true };
    },
    { permission: "attestation.manage_pins", params: t.Object({ userId: t.String() }) }
  )
```

- [ ] **Step 4:** `bunx tsc --noEmit | grep modules/attestation` clean. Commit.

---

## Task 3: i18n

- [ ] Add `attestation.managerPins` to all 4 locales: `title, login, name, pinSet, pinNotSet, setPin, resetPin, newPin, saved, cleared, invalid, search, confirmReset`. Plus `attestation.nav.managerPins`. Validate JSON. Commit.

---

## Task 4: Frontend page + sub-nav

**Files:** create `admin/app/[locale]/attestation/manager-pins/page.tsx`; modify `admin/components/layout/attestation-layout.tsx`.

- [ ] **Step 1:** Add sub-nav item `{ href: "/attestation/manager-pins", label: t("managerPins"), icon: KeyRound (or ShieldCheck), permission: "attestation.manage_pins" }`.

- [ ] **Step 2:** Build the page: search input (debounced), table (login/name/pin-status/actions), TanStack Query list (`apiClient.api.attestation["manager-pins"].get({ query })`), set-PIN dialog (`.["manager-pins"]({ userId }).post({ data: { pin } })`), reset (`.delete({})` with confirm). Invalidate list on success; toast.

- [ ] **Step 3:** `bunx tsc --noEmit` (admin) → 0. Commit.

---

## Task 5: Local verify + Task 6: Deploy (on explicit authorization)

- [ ] Local: central account sees page; list shows only attestation.run accounts; set PIN flips ✓; kiosk accepts it; reset flips ✗.
- [ ] Deploy: seed + grant `attestation.manage_pins` on prod; scp controller/messages/new page/attestation-layout; commit; rebuild backend + admin; restart; pm2 save.

## Self-Review

- Admin set/reset (T2 POST/DELETE) + list only attestation.run (T2 helper) ✓; gate new permission (T1) ✓; page + nav (T4) ✓; membership re-check on write ✓; no hash leak ✓; self-service untouched ✓.
