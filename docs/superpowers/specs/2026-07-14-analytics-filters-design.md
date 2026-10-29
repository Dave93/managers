# Attestation Analytics Filters — Design

**Date:** 2026-07-14
**Status:** Approved (design)

## Problem

The attestation analytics attempts table has only a passed/failed select. Add **Test**, **Branch**, and **employee search** filters. Terminal-scope (HQ model) still applies server-side.

## Filters

- **Test** — dropdown of tests → `test_id` (backend already supports).
- **Branch** — dropdown of terminals ("Все" = none) → `terminal_id` (backend already supports).
- **Employee search** — ФИО substring → `search` (NEW backend param).
- Keep the existing **passed** select (Все / Сдали / Не сдали).
- Reset button.

## Backend

`GET /attestation/analytics/attempts` — add optional `search` param. The query already `leftJoin`s `employees`; add:
`if (search) where.push(or(ilike(employees.first_name, "%s%"), ilike(employees.last_name, "%s%")))`.
`test_id`, `terminal_id`, `passed` unchanged. Scope (`!isHQ → inArray terminal`) unchanged.

## Frontend

`admin/app/[locale]/attestation/analytics/page.tsx` — add a filter bar above the tiles→table:
- Test `Select` (from `apiClient.api.attestation.tests.get`, "Все").
- Branch `Select` (from `apiClient.api.terminals.cached.get`, "Все", sorted by name).
- Search `Input` (debounced ~300 ms).
- Existing passed `Select`.
- Reset button.

Filters go into the attempts query (`queryKey` + request query, omit empty). The summary tiles stay unfiltered (branch-scoped only) — they show the overall picture.

i18n: reuse `attestation.filters.{search,branch,all,reset}`; add `attestation.filters.test` = "Тест" (+ en/uz).

## Non-goals

- No status filter, no date range, no pagination changes (list stays limit 100).
- Summary tiles are not filtered.

## Testing (local)

- Test filter narrows to one test; branch narrows; search by ФИО narrows; passed still works; combined AND; reset clears. Manager-scoped account only sees own-branch rows.
