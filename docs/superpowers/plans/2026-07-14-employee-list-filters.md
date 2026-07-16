# Employee-List Filters Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Add search / branch / position / active filters to the attestation employees list (backend + UI), respecting terminal-scope.

**Tech Stack:** Elysia · Drizzle (`ilike`, `or`) · Next.js · TanStack Query · shadcn Select/Input · next-intl.

## Global Constraints

- Filters AND with the existing `isHQ` terminal-scope. Server scope always wins.
- Empty filter values are omitted from the request and produce no WHERE clause.
- Backend deploy = recompile `app` + restart `office_api`; admin = `bun run build` + restart `office_admin` (node20).

---

## Task 1: Backend filter params

**Files:** Modify `backend/src/modules/attestation/controller.ts` (employees list handler).

- [ ] **Step 1: Extend imports** — ensure `or, ilike` are imported from `drizzle-orm` (add to the existing import).

- [ ] **Step 2: Rewrite the list handler**

```ts
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const { limit, offset, search, terminal_id, position, active } = query;
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) where.push(inArray(employees.terminal_id, terminals));
      if (search)
        where.push(
          or(
            ilike(employees.first_name, `%${search}%`),
            ilike(employees.last_name, `%${search}%`)
          )
        );
      if (terminal_id) where.push(eq(employees.terminal_id, terminal_id));
      if (position) where.push(ilike(employees.position, `%${position}%`));
      if (active === "true" || active === "false")
        where.push(eq(employees.active, active === "true"));
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(employees)
        .where(and(...where))
        .execute();
      const rows = await drizzle
        .select()
        .from(employees)
        .where(and(...where))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: count[0].count, data: rows.map(stripPin) };
    },
    {
      permission: "employees.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        search: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        position: t.Optional(t.String()),
        active: t.Optional(t.String()),
      }),
    }
```

- [ ] **Step 3:** `bunx tsc --noEmit | grep modules/attestation | grep "error TS"` → clean. Commit.

---

## Task 2: i18n keys

**Files:** Modify `admin/messages/{en,ru,uz-Latn,uz-Cyrl}.json` — add `attestation.filters`:
`search`, `branch`, `position`, `active`, `all`, `activeYes`, `activeNo`, `reset`.

- [ ] Add keys (ru): search "Поиск (ФИО)", branch "Филиал", position "Должность", active "Активность", all "Все", activeYes "Активные", activeNo "Неактивные", reset "Сброс". Translate for en/uz-Latn/uz-Cyrl. Validate JSON. Commit.

---

## Task 3: Filter bar in data-table

**Files:** Modify `admin/app/[locale]/attestation/employees/data-table.tsx`.

- [ ] **Step 1:** Add filter state (`search, terminalId, position, active`) via `useState`; a debounced copy of `search`/`position` (~300 ms) via a small `useEffect` timer. Fetch terminals via `useQuery(["terminals_cached"], () => apiClient.api.terminals.cached.get())`.

- [ ] **Step 2:** Include filters in `queryKey` and the request `query` (omit empty). Reset `pageIndex` to 0 when any filter changes (effect on the debounced/select values).

- [ ] **Step 3:** Render a filter bar above the table: search `Input`, branch `Select` (+ "Все"), position `Input`, active `Select` (Все/Активные/Неактивные), "Сброс" `Button`. Use `t("filters.*")`.

- [ ] **Step 4:** `bunx tsc --noEmit` (admin) → 0 errors. Commit.

---

## Task 4: Local verify (chrome-attach)

- [ ] Search narrows; branch select narrows; position narrows; active toggle; combined AND; reset clears. Manager-scoped account filters within its branch only.

---

## Task 5: Deploy (on explicit authorization)

- [ ] scp controller.ts + messages + data-table.tsx to prod; commit; rebuild backend binary + restart office_api; rebuild admin + restart office_admin; pm2 save; smoke.

## Self-Review

- Filters (search/branch/position/active) ✓ backend (T1) + UI (T3). i18n (T2). Scope preserved (T1 `!isHQ` push first). No attestation-status filter (non-goal) ✓.
