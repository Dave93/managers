# Per-Terminal Playground Ticket Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins opt individual terminals in/out of playground-ticket generation via a boolean flag on `terminals`, enforced in the backend and surfaced in the admin terminal edit form.

**Architecture:** Single boolean column `terminals.playground_enabled`. The generate endpoint checks the flag (and terminal/org ownership) before creating a ticket. The admin terminal form gains a labeled switch with a user-facing hint. The iiko plugin requires no code changes — it already skips QR printing when the API call fails.

**Tech Stack:** Bun, Elysia, Drizzle ORM, PostgreSQL, Next.js 15, React 19, TanStack Query, `@tanstack/react-form`, `@admin/components/ui/switch`.

**Spec:** `docs/superpowers/specs/2026-04-17-playground-per-terminal-design.md`

**Note on tests:** The `managers` repo has no automated test infra (`package.json: "test": "echo \"Error: no test specified\" && exit 1"`). Following the convention set by the original `2026-03-17-playground-tickets` plan, this plan uses manual verification steps (psql queries, curl calls, UI click-throughs) in place of automated tests. Do **not** introduce a test framework as part of this feature.

---

## File Structure

### Backend (`C:\projects\managers\backend`)
- **Modify:** `drizzle/schema.ts` — add `playground_enabled` column to `terminals` table.
- **Create:** `drizzle/migrations/<N>_<name>.sql` — generated migration + backfill statement.
- **Modify:** `src/modules/playground_tickets/controller.ts` — add terminal lookup and enforcement in `POST /playground_tickets/generate`.
- **Modify:** `src/modules/terminals/controller.ts` — accept `playground_enabled` in POST and PUT body schemas.

### Admin (`C:\projects\managers\admin`)
- **Modify:** `components/forms/terminals/_form.tsx` — add `playground_enabled` field, switch, hint text, and mutation-payload type updates.
- **Modify:** `app/[locale]/organization/terminals/columns.tsx` — swap the Edit button to use `TerminalsFormSheet` instead of `OrganizationsFormSheet` (pre-existing wiring bug the new toggle needs fixed to be reachable).

### iiko Plugin (`C:\projects\tablo_full\new_webserver`)
No changes. Existing error path already returns `null` on non-2xx and guards `SetTicketForOrder` with `if (ticket != null)`.

---

## Task 1: Schema + Migration

**Files:**
- Modify: `C:\projects\managers\backend\drizzle\schema.ts` (lines 497–513, `terminals` table)
- Create: `C:\projects\managers\backend\drizzle\migrations\<next-number>_<slug>.sql` (generated)

- [ ] **Step 1: Add `playground_enabled` to the `terminals` schema**

Edit `backend/drizzle/schema.ts`. Inside `pgTable("terminals", { ... })`, add the new column after `manager_name`:

```typescript
export const terminals = pgTable("terminals", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  phone: text("phone"),
  address: text("address"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  organization_id: uuid("organization_id").notNull(),
  manager_name: text("manager_name"),
  playground_enabled: boolean("playground_enabled").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});
```

- [ ] **Step 2: Generate the migration**

From `C:\projects\managers\backend`:

```bash
bunx drizzle-kit generate
```

Expected: a new file under `drizzle/migrations/` (e.g. `0007_<random-slug>.sql`) containing something like:

```sql
ALTER TABLE "terminals" ADD COLUMN "playground_enabled" boolean DEFAULT false NOT NULL;
```

- [ ] **Step 3: Append the backfill statement to the generated migration**

Open the newly generated SQL file and append, after the existing `ALTER TABLE` line (add `--> statement-breakpoint` between statements):

```sql
--> statement-breakpoint
UPDATE "terminals" SET "playground_enabled" = true;
```

This preserves current behavior for terminals that already exist (per the design decision: default `false` for new rows, `true` for existing).

- [ ] **Step 4: Apply the migration locally**

From `C:\projects\managers\backend`:

```bash
bunx drizzle-kit migrate
```

Expected: migration applied without errors.

- [ ] **Step 5: Verify with psql**

Run (adjust connection string to local env):

```bash
psql "$DATABASE_URL" -c "SELECT id, name, playground_enabled FROM terminals LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FILTER (WHERE playground_enabled) AS enabled, COUNT(*) FILTER (WHERE NOT playground_enabled) AS disabled FROM terminals;"
```

Expected: all pre-existing rows have `playground_enabled = true`; counts show `disabled = 0` on a freshly-migrated DB with no new inserts.

- [ ] **Step 6: Commit**

```bash
cd C:/projects/managers
git add backend/drizzle/schema.ts backend/drizzle/migrations/
git commit -m "feat: add playground_enabled flag to terminals table"
```

---

## Task 2: Backend enforcement in `/playground_tickets/generate`

**Files:**
- Modify: `C:\projects\managers\backend\src\modules\playground_tickets\controller.ts` (lines 12–78)

- [ ] **Step 1: Add terminal lookup and enforcement**

In `backend/src/modules/playground_tickets/controller.ts`, locate the `POST /playground_tickets/generate` handler. The current code sets `organization_id` and then immediately computes `children_count`:

```typescript
      const organization_id = token.organization_id;
      const children_count = Math.floor(order_amount / 50000);

      if (children_count < 1) {
        set.status = 400;
        return { message: "Order amount too low for playground ticket" };
      }
```

Insert the new block **between** `const organization_id = token.organization_id;` and `const children_count = ...`:

```typescript
      const organization_id = token.organization_id;

      const terminalRow = await drizzle
        .select({
          id: terminals.id,
          organization_id: terminals.organization_id,
          playground_enabled: terminals.playground_enabled,
        })
        .from(terminals)
        .where(eq(terminals.id, terminal_id))
        .execute();

      if (
        terminalRow.length === 0 ||
        terminalRow[0].organization_id !== organization_id
      ) {
        set.status = 404;
        return { message: "Terminal not found" };
      }

      if (!terminalRow[0].playground_enabled) {
        set.status = 403;
        return { message: "Playground tickets disabled for this terminal" };
      }

      const children_count = Math.floor(order_amount / 50000);
```

(The file already imports `terminals` from `backend/drizzle/schema` on line 3 and `eq` from `drizzle-orm` on line 5 — no new imports needed.)

- [ ] **Step 2: Start the backend in dev mode**

From `C:\projects\managers\backend`:

```bash
bun run --watch src/index.ts
```

Expected: server starts on port 6761 without type errors.

- [ ] **Step 3: Verify enforcement with curl**

Open a second terminal. You will need: a valid `api_tokens.token` (`TOKEN=...`), an enabled terminal UUID (`ENABLED_ID=...`), a disabled terminal UUID (`DISABLED_ID=...`) in the same org as the token, and a UUID belonging to a *different* org (`FOREIGN_ID=...`). Prepare them:

```bash
# Flip a known terminal to disabled for this test
psql "$DATABASE_URL" -c "UPDATE terminals SET playground_enabled = false WHERE id = '<DISABLED_ID>';"
```

Then hit the endpoint three times:

```bash
# 1) enabled terminal — expect 200 with ticket payload
curl -s -X POST http://localhost:6761/api/playground_tickets/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminal_id":"'"$ENABLED_ID"'","order_number":"TEST-1","order_amount":60000}' | jq .

# 2) disabled terminal — expect 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:6761/api/playground_tickets/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminal_id":"'"$DISABLED_ID"'","order_number":"TEST-2","order_amount":60000}'

# 3) foreign-org terminal — expect 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:6761/api/playground_tickets/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminal_id":"'"$FOREIGN_ID"'","order_number":"TEST-3","order_amount":60000}'
```

Expected:
1. `200` — JSON response with `ticket_id`, `children_count`, `qr_data`.
2. `403`.
3. `404`.

- [ ] **Step 4: Restore test terminal**

```bash
psql "$DATABASE_URL" -c "UPDATE terminals SET playground_enabled = true WHERE id = '<DISABLED_ID>';"
```

- [ ] **Step 5: Commit**

```bash
cd C:/projects/managers
git add backend/src/modules/playground_tickets/controller.ts
git commit -m "feat: enforce per-terminal playground_enabled in generate endpoint"
```

---

## Task 3: Accept `playground_enabled` in terminals POST / PUT

**Files:**
- Modify: `C:\projects\managers\backend\src\modules\terminals\controller.ts` (lines 72–83 for POST, lines 164–174 for PUT)

- [ ] **Step 1: Add `playground_enabled` to POST body schema**

In `backend/src/modules/terminals/controller.ts`, locate the `POST /terminals` body schema:

```typescript
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
        }),
      }),
```

Add one line before the closing inner brace:

```typescript
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
          playground_enabled: t.Optional(t.Boolean()),
        }),
      }),
```

- [ ] **Step 2: Add `playground_enabled` to PUT body schema**

In the same file, the `PUT /terminals/:id` body schema currently ends:

```typescript
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
        }),
```

Add the same line:

```typescript
      body: t.Object({
        data: t.Object({
          name: t.String(),
          active: t.Optional(t.Boolean()),
          phone: t.Optional(t.String()),
          address: t.Optional(t.String()),
          latitude: t.Number(),
          longitude: t.Number(),
          organization_id: t.String(),
          manager_name: t.Optional(t.String()),
          playground_enabled: t.Optional(t.Boolean()),
        }),
```

- [ ] **Step 3: Verify the dev server reloads cleanly**

With `bun run --watch src/index.ts` still running, save the file and check the terminal output. Expected: no TypeScript or Elysia schema errors, server reloads.

- [ ] **Step 4: Smoke-test PUT via curl**

Get a session cookie by logging into the admin in a browser, copy the cookie header, then:

```bash
# Get a terminal's current state
curl -s "http://localhost:6761/api/terminals/<TERMINAL_ID>" \
  -H "Cookie: <your-session-cookie>" | jq .

# Toggle playground_enabled to false
curl -s -X PUT "http://localhost:6761/api/terminals/<TERMINAL_ID>" \
  -H "Cookie: <your-session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"<existing-name>","latitude":<lat>,"longitude":<lng>,"organization_id":"<org-id>","playground_enabled":false}}' | jq .

# Confirm persisted
psql "$DATABASE_URL" -c "SELECT id, name, playground_enabled FROM terminals WHERE id = '<TERMINAL_ID>';"
```

Expected: the PUT returns success; psql shows `playground_enabled = f`.

- [ ] **Step 5: Restore and commit**

Flip the terminal back to `true` via psql (or leave as-is; the admin UI will re-toggle it in Task 4 verification).

```bash
cd C:/projects/managers
git add backend/src/modules/terminals/controller.ts
git commit -m "feat: allow playground_enabled in terminals POST/PUT body schemas"
```

---

## Task 4: Admin form — add switch with hint

**Files:**
- Modify: `C:\projects\managers\admin\components\forms\terminals\_form.tsx`

- [ ] **Step 1: Extend form value and mutation payload types**

Open `admin/components/forms/terminals/_form.tsx`. There are three places where the terminal-payload TS type is declared (lines 33–42 for `createMutation`, lines 52–62 for `updateMutation`, lines 74–83 for `useForm`). Add `playground_enabled?: boolean;` to each:

```typescript
  const createMutation = useMutation({
    mutationFn: (newTodo: {
      name: string;
      active?: boolean;
      phone?: string;
      address?: string;
      latitude: number;
      longitude: number;
      organization_id: string;
      manager_name?: string;
      playground_enabled?: boolean;
    }) => {
```

```typescript
  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: {
        name: string;
        active?: boolean;
        phone?: string;
        address?: string;
        latitude: number;
        longitude: number;
        organization_id: string;
        manager_name?: string;
        playground_enabled?: boolean;
      };
      id: string;
    }) => {
```

```typescript
  // @ts-ignore
  const form = useForm<{
    name: string;
    active?: boolean;
    phone?: string;
    address?: string;
    latitude: number;
    longitude: number;
    organization_id: string;
    manager_name?: string;
    playground_enabled?: boolean;
  }>({
    defaultValues: {
      active: true,
      name: "",
      phone: "",
      latitude: 0,
      longitude: 0,
      organization_id: "",
      playground_enabled: false,
    },
```

- [ ] **Step 2: Hydrate the field from the loaded record**

Inside the existing `useEffect` that syncs `record.data` → form (lines 117–124), add the new setter:

```typescript
  useEffect(() => {
    if (record?.data && "id" in record.data) {
      form.setFieldValue("active", record.data.active);
      form.setFieldValue("name", record.data.name);
      //   form.setFieldValue("description", record.description);
      form.setFieldValue("phone", record.data.phone ?? "");
      form.setFieldValue(
        "playground_enabled",
        record.data.playground_enabled ?? false
      );
    }
  }, [record, form]);
```

- [ ] **Step 3: Render the Switch and hint text**

Below the "Телефон" `<div className="space-y-2">` block (ends around line 197) and above the commented-out "Описание" block, insert:

```tsx
      <div className="space-y-2">
        <div>
          <Label>Детская площадка</Label>
        </div>
        <form.Field name="playground_enabled">
          {(field) => {
            return (
              <>
                <Switch
                  checked={field.getValue() ?? false}
                  onCheckedChange={field.setValue}
                />
              </>
            );
          }}
        </form.Field>
        <p className="text-sm text-muted-foreground">
          Если включено — при оплате заказа на сумму от установленного минимума
          на чеке дополнительно печатается QR-билет для детской площадки.
          Выключите, если в этом филиале нет детской площадки.
        </p>
      </div>
```

(`Switch` is already imported on line 3; `Label` on line 8.)

- [ ] **Step 4: Type-check and build the admin bundle**

From `C:\projects\managers\admin`:

```bash
bun run build
```

Expected: build succeeds with no TypeScript errors. If `@admin/utils/eden` types complain about `playground_enabled` not being on the Eden-typed `data` shape, confirm Task 3 was applied and rebuild the backend first so the type is regenerated.

- [ ] **Step 5: Commit**

```bash
cd C:/projects/managers
git add admin/components/forms/terminals/_form.tsx
git commit -m "feat: add playground_enabled switch to terminal edit form"
```

---

## Task 5: Wire the Edit button to the terminals form

**Files:**
- Modify: `C:\projects\managers\admin\app\[locale]\organization\terminals\columns.tsx` (lines 8 and 32)

- [ ] **Step 1: Swap the import**

Change line 8 from:

```typescript
import OrganizationsFormSheet from "@admin/components/forms/organizations/sheet";
```

to:

```typescript
import TerminalsFormSheet from "@admin/components/forms/terminals/sheet";
```

- [ ] **Step 2: Swap the component usage**

Change the Edit button block (around line 31–37) from:

```tsx
            <CanAccess permission="terminals.edit">
              <OrganizationsFormSheet recordId={record.id}>
                <Button variant="outline" size="sm">
                  <Edit2Icon className="h-4 w-4" />
                </Button>
              </OrganizationsFormSheet>
            </CanAccess>
```

to:

```tsx
            <CanAccess permission="terminals.edit">
              <TerminalsFormSheet recordId={record.id}>
                <Button variant="outline" size="sm">
                  <Edit2Icon className="h-4 w-4" />
                </Button>
              </TerminalsFormSheet>
            </CanAccess>
```

- [ ] **Step 3: Manual UI verification**

Start the admin dev server:

```bash
cd C:/projects/managers/admin
bun dev
```

In a browser (port 6762):

1. Log in → navigate to Организация → Terminals.
2. Click the Edit (pencil) icon on a terminal.
3. Verify the sheet opens with the **Terminals** form (fields: Активность, Название, Телефон, **Детская площадка**), not the Organizations form.
4. Verify the hint paragraph under the switch reads:
   > Если включено — при оплате заказа на сумму от установленного минимума на чеке дополнительно печатается QR-билет для детской площадки. Выключите, если в этом филиале нет детской площадки.
5. Toggle the switch and click Submit. Close the sheet, reopen — the switch should reflect the new value.
6. Verify in psql:

```bash
psql "$DATABASE_URL" -c "SELECT id, name, playground_enabled FROM terminals WHERE id = '<TERMINAL_ID>';"
```

Expected: `playground_enabled` matches the toggle state.

- [ ] **Step 4: Commit**

```bash
cd C:/projects/managers
git add admin/app/[locale]/organization/terminals/columns.tsx
git commit -m "fix: route terminal Edit button to TerminalsFormSheet"
```

---

## Task 6: End-to-end verification

No file changes. Confirms the whole flow works with the plugin.

- [ ] **Step 1: Toggle a real terminal off in the admin**

Pick an iiko terminal whose host-terminal-group ID is known to you (check iiko config). Open it in the admin, turn "Детская площадка" **off**, click Submit.

- [ ] **Step 2: Run a qualifying sale from iiko**

On that terminal, ring up an order with sum ≥ the configured `PlaygroundMinAmount` and proceed to payment screen. Inspect the iiko plugin log (Resto.Front.Api log file):

Expected log lines:
- `Playground: Order sum N >= M, generating ticket`
- `Playground: Failed to generate ticket after K attempts: ...` (HTTP 403 error body)
- **No** `Playground: Ticket set for order ...` line.
- Receipt printed **without** QR code.

- [ ] **Step 3: Toggle on and repeat**

Turn the switch **on** in admin, submit, then ring up another qualifying sale.

Expected log lines:
- `Playground: Order sum N >= M, generating ticket`
- `Playground: Ticket generated - ID: <uuid>, Children: <n>`
- `Playground: Ticket set for order <order-uuid>`
- Receipt prints **with** QR code and "БИЛЕТ ДЕТСКОЙ ПЛОЩАДКИ" block.

- [ ] **Step 4: Confirm ticket row in DB**

```bash
psql "$DATABASE_URL" -c "SELECT id, terminal_id, children_count, created_at FROM playground_tickets ORDER BY created_at DESC LIMIT 3;"
```

Expected: the latest row has the correct `terminal_id` and a sensible `children_count`.

- [ ] **Step 5: Push branch and open PR**

```bash
cd C:/projects/managers
git push -u origin shahzod
gh pr create --title "feat: per-terminal playground ticket toggle" --body "$(cat <<'EOF'
## Summary
- Adds `terminals.playground_enabled` boolean (default `false`, existing rows backfilled to `true`).
- `POST /api/playground_tickets/generate` now verifies terminal belongs to the token's org and that playground is enabled; returns 404 / 403 otherwise.
- Terminal edit form gains a "Детская площадка" switch with a user-facing hint explaining the behavior.
- Fixes pre-existing bug: the terminals list Edit button now opens `TerminalsFormSheet` (previously opened the unrelated `OrganizationsFormSheet`).

## Test plan
- [x] Migration applied locally; backfill UPDATE sets existing terminals to enabled.
- [x] curl verifies generate returns 200 / 403 / 404 depending on terminal state and ownership.
- [x] Admin UI: toggle persists, hint text reads correctly.
- [x] Plugin end-to-end: QR prints only when terminal toggle is on.

Spec: `docs/superpowers/specs/2026-04-17-playground-per-terminal-design.md`
EOF
)"
```

Expected: PR URL printed. Hand off to reviewer.

---

## Self-review results

- **Spec coverage:** Every spec section has a task — Schema (Task 1), Backend enforcement (Task 2), Terminals body-schema extension (Task 3, implicit in spec §3.3), Admin form with hint (Task 4), Columns wiring fix (Task 5), Plugin no-op validated in Task 6.
- **Placeholders:** None — every code block shows full content; every verify step includes concrete commands and expected output.
- **Type consistency:** `playground_enabled` used uniformly everywhere (schema, TypeBox, TS types, form field name, psql column).
- **Out-of-scope temptations resisted:** No new test framework, no dedicated playground settings page, no per-terminal `min_amount` override.
