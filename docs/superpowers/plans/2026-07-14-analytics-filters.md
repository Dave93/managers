# Analytics Filters Implementation Plan

> Use superpowers:executing-plans. Steps `- [ ]`.

**Goal:** Test / Branch / employee-search filters on the attestation analytics attempts table.

## Global Constraints

- Terminal-scope (isHQ) unchanged. Empty filters omitted.
- Backend deploy = recompile `app` + restart office_api; admin = build + restart office_admin (node20).

---

## Task 1: Backend `search` on analytics attempts

**Files:** `backend/src/modules/attestation/controller.ts`.

- [ ] In `GET /attestation/analytics/attempts`, add `search` to the query schema (`search: t.Optional(t.String())`) and, after the existing filters:

```ts
      if (query.search)
        where.push(
          or(
            ilike(employees.first_name, `%${query.search}%`),
            ilike(employees.last_name, `%${query.search}%`)
          )
        );
```
(`or`, `ilike` already imported.) Typecheck clean. Commit.

---

## Task 2: i18n `filters.test`

**Files:** `admin/messages/*.json`.

- [ ] Add `attestation.filters.test`: ru "Тест", en "Test", uz-Latn "Test", uz-Cyrl "Тест". Validate JSON. Commit.

---

## Task 3: Analytics filter bar

**Files:** `admin/app/[locale]/attestation/analytics/page.tsx`.

- [ ] **Step 1:** Add filter state: `testId, terminalId, search` (+ debounced search). Queries: tests list (`apiClient.api.attestation.tests.get({ query: { limit:"200", offset:"0", fields:"id,title" } })`), terminals (`apiClient.api.terminals.cached.get()`, sorted by name).

- [ ] **Step 2:** Include `test_id`/`terminal_id`/`search` (omit empty) in the attempts query + `queryKey`. Keep the existing `passed`.

- [ ] **Step 3:** Render filter bar: Test `Select` ("Все" + tests), Branch `Select` ("Все" + sorted terminals), Search `Input` (debounced), existing passed `Select`, Reset `Button`. Use `t("filters.*")` / `t("analytics.*")`.

- [ ] **Step 4:** `bunx tsc --noEmit` (admin) → 0. Commit.

---

## Task 4: Local verify + Task 5: Deploy (on explicit authorization)

- [ ] Local: each filter narrows; combined AND; reset clears.
- [ ] Deploy: scp controller.ts + messages + analytics page; commit; rebuild backend + admin; restart; pm2 save.

## Self-Review

- Test/Branch/search filters (T1 backend search + T3 UI) ✓; existing passed kept ✓; scope unchanged ✓; summary unfiltered (non-goal) ✓.
