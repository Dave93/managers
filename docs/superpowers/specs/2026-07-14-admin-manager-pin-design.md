# Admin-Managed Manager PINs — Design

**Date:** 2026-07-14
**Status:** Approved (design)
**Depends on:** manager test-mode (shipped) — `users.attestation_pin_hash` column exists.

## Problem

Manager launch-PINs are currently self-service only (the `/attestation/pin` "Мой PIN" page sets the logged-in account's own PIN). For rollout, a central admin needs to **set/reset** the PIN of any branch-manager account (provisioning + forgotten-PIN recovery), without logging in as that manager.

## Solution

A central page **"PIN менеджеров"** in the attestation section that lists branch-manager accounts and lets an admin set or clear each one's PIN. Self-service ("Мой PIN") stays.

- **Who is listed:** only user accounts whose role holds `attestation.run` (real test-launchers). Search by login / name, paginated.
- **Actions:** set/replace PIN (4–6 digits), clear PIN.
- **Gate:** new permission `attestation.manage_pins` (central). Granted to central admin roles; not to branch managers.

No DB migration (`users.attestation_pin_hash` already exists).

## Backend

New permission slug `attestation.manage_pins` (added to `seed-permissions.ts`).

Endpoints on the attestation controller, all `permission: "attestation.manage_pins"`:

- `GET /attestation/manager-pins?limit&offset&search`
  - Resolve role_ids holding `attestation.run`:
    `select rp.role_id from roles_permissions rp join permissions p on p.id=rp.permission_id where p.slug='attestation.run'`.
  - `select id, login, first_name, last_name, (attestation_pin_hash is not null) as has_pin from users where role_id in (<those>)` + optional `search` (`login/first_name/last_name ILIKE %..%`), `limit/offset`. Return `{ total, data }`. Never return the hash.
- `POST /attestation/manager-pins/:userId` — body `{ data: { pin } }`; validate `/^\d{4,6}$/`; `update users set attestation_pin_hash = argon2(pin) where id=:userId` (only if that user is in the attestation.run set → else 404/403). Return `{ ok: true }`.
- `DELETE /attestation/manager-pins/:userId` — `update users set attestation_pin_hash = null where id=:userId` (same membership check). Return `{ ok: true }`.

Reuse `Bun.password.hash`. Membership check prevents setting PINs on arbitrary users.

## Frontend

New page `admin/app/[locale]/attestation/manager-pins/page.tsx`:
- Table: Логин · ФИО · PIN (✓/✗) · действия (Задать/Сменить PIN, Сбросить).
- Search input (debounced), pagination (mirror the employees data-table pattern).
- Set-PIN dialog: password input (4–6 digits) → `POST`. Reset → `DELETE` with confirm.
- Eden paths: `apiClient.api.attestation["manager-pins"].get(...)`, `.["manager-pins"]({ userId }).post(...)`, `.delete(...)`.

Sub-nav: add "PIN менеджеров" to `attestation-layout.tsx` gated `attestation.manage_pins`.

i18n: `attestation.managerPins` namespace (title, login, name, pinSet, pinNotSet, setPin, resetPin, newPin, saved, cleared, invalid, search, confirmReset).

## Non-goals

- No per-branch scoping of this list (it is a central HQ tool).
- Does not change the self-service "Мой PIN" page.

## Deploy

- Backend: seed `attestation.manage_pins`, grant to central role, controller endpoints. Recompile `app`, restart `office_api`.
- Admin: new page + sub-nav item + i18n. Rebuild, restart `office_admin`.

## Testing (local)

- Central account (with `attestation.manage_pins`) sees the page; list shows only `attestation.run` accounts with PIN status.
- Set PIN → status flips to ✓; the kiosk then accepts that PIN for that manager.
- Reset → status ✗.
- A non-managed user id in POST/DELETE → 404.
