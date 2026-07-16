# Attestation Employee-List Filters — Design

**Date:** 2026-07-14
**Status:** Approved (design)
**Depends on:** employee-attestation feature (shipped)

## Problem

The attestation employees list (`/attestation/employees`) only paginates — no way to find people across 390 employees / 33 branches. Add filters to make the roster workable.

## Filters

- **Search (ФИО):** matches `first_name` OR `last_name`, case-insensitive substring.
- **Branch (terminal):** dropdown of terminals; "Все" = no filter.
- **Position (должность):** case-insensitive substring.
- **Active:** Все / Активные / Неактивные.

All filters combine with AND, and with the existing terminal-scope (`isHQ` model). A branch manager selecting another branch still gets nothing — the server scope wins.

## Backend

`GET /attestation/employees` gains optional query params (all `t.Optional(t.String())`), added to the existing `limit/offset`:

- `search` → `or(ilike(employees.first_name, "%s%"), ilike(employees.last_name, "%s%"))`
- `terminal_id` → `eq(employees.terminal_id, v)`
- `position` → `ilike(employees.position, "%v%")`
- `active` → `eq(employees.active, v === "true")` (only when `v` is "true" or "false")

`where` = `and(...scope, ...filterClauses)`. Count query uses the same where. `ilike`/`or` imported from `drizzle-orm`.

## Frontend

`admin/app/[locale]/attestation/employees/data-table.tsx` gets a filter bar above the table:
- Search input (debounced ~300 ms) → `search`.
- Branch `Select` (options from `apiClient.api.terminals.cached.get()`, plus "Все") → `terminal_id`.
- Position input (debounced) → `position`.
- Active `Select` (Все / Активные / Неактивные) → `active`.
- "Сброс" button clears all.

Filter state = local `useState`; included in the TanStack Query `queryKey`; changing any filter resets `pageIndex` to 0. Empty filters are omitted from the request query.

i18n: add keys under `attestation.filters` in all 4 locales (search, branch, position, active, all, activeYes, activeNo, reset).

## Non-goals

- No attestation-status (passed/failed) filter — out of scope.
- No saved/URL-persisted filters (local state only).

## Testing (local)

- Search "Ив" → matches Иван; branch filter narrows; position "Повар" narrows; active toggle works; combined filters AND correctly; reset clears.
- Manager-scoped account: filters operate only within the manager's branch.
