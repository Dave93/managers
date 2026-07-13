# Employee Security Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an employee security-attestation subsystem — HQ-authored tests, anti-impersonation take-test flow on shared branch tablets, and terminal-scoped analytics.

**Architecture:** New Elysia module `backend/src/modules/attestation` over 6 new Drizzle tables. Anti-impersonation = manager-launch (branch account with `attestation.run`) + per-employee PIN verified server-side. Grading, timer, and answer sanitization are server-side only. Admin UI mirrors the existing permissions/sales-plans CRUD patterns; a dedicated fullscreen kiosk route runs the test.

**Tech Stack:** Bun · Elysia · Drizzle (PostgreSQL) · Eden treaty client · Next.js 15 / React 19 · TanStack Query + TanStack Table + TanStack Form · shadcn/ui · next-intl · `Bun.password` (argon2id) for PIN hashing · `bun test` for pure-logic unit tests.

## Global Constraints

- Backend module pattern: each domain is an Elysia plugin exported from `controller.ts`, built with `new Elysia({ name: "@api/<name>" }).use(ctx)`, and **must** be registered in `backend/src/controllers.ts` via `.use(<name>Controller)` on `apiController` or its routes never mount.
- Drizzle schema is the single file `backend/drizzle/schema.ts`. Columns use snake_case. Timestamps use `timestamp(col, { withTimezone: true, mode: "string" }).defaultNow().notNull()`. PKs use `uuid("id").defaultRandom().primaryKey().notNull()`.
- Auth is cookie-based. Route protection uses the `permission: "<slug>"` macro (checks Redis-cached role permissions, returns 401/403) or `userAuth: true`. Handlers receive resolved `user`, `role`, `terminals` (a `string[]` of terminal ids).
- List endpoints accept `limit, offset, sort?, filters?, fields?` (all `t.String()`), return `{ total, data }`. Use `parseSelectFields` / `parseFilterFields`.
- POST/PUT bodies are wrapped: `body: t.Object({ data: t.Object({...}) })`.
- Eden path mirrors the route tree: route `/attestation/tests` → `apiClient.api.attestation.tests.get()`; `/attestation/tests/:id` → `apiClient.api.attestation.tests({ id }).get()`.
- Migrations: run `drizzle-kit generate` then `drizzle-kit migrate` from `backend/`. Review generated SQL — migrations are NOT idempotent. `meta/_journal.json` is the order source of truth.
- **Security invariants (never regress):** (a) take-test payload NEVER contains `is_correct`; (b) grading is server-side only; (c) the timer is authoritative on the server via `started_at`; (d) `pin_hash` is never returned in any response; (e) attempt answers are snapshotted so later test edits cannot rewrite history.
- **HQ rule:** `const isHQ = user?.is_super_user === true;`. Non-HQ callers are scoped to their `terminals` array via `inArray(...)`. HQ bypasses scoping.
- Admin CRUD file layout per domain: `app/[locale]/<area>/<name>/page.tsx` + `data-table.tsx` + `columns.tsx` + `delete-action.tsx`, plus `components/forms/<name>/sheet.tsx` + `_form.tsx`.

---

## File Structure

**Backend**
- `backend/drizzle/schema.ts` (modify) — add 3 enums + 6 tables.
- `backend/src/modules/attestation/grading.ts` (create) — pure grading + sampling/shuffle helpers.
- `backend/src/modules/attestation/grading.test.ts` (create) — `bun test` unit tests.
- `backend/src/modules/attestation/controller.ts` (create) — the Elysia plugin (all endpoints).
- `backend/src/controllers.ts` (modify) — register the controller.
- `backend/src/modules/attestation/seed-permissions.ts` (create) — idempotent permission-slug seeder.

**Admin**
- `admin/components/layout/attestation-layout.tsx` (create) + `main-layout.tsx` (modify) — layout gate.
- `admin/app/[locale]/attestation/tests/{page,data-table,columns,delete-action}.tsx` (create).
- `admin/components/forms/attestation-test/{sheet,_form}.tsx` (create).
- `admin/app/[locale]/attestation/tests/[id]/questions/page.tsx` (create) — question-bank editor.
- `admin/app/[locale]/attestation/employees/{page,data-table,columns,delete-action}.tsx` (create).
- `admin/components/forms/attestation-employee/{sheet,_form}.tsx` (create).
- `admin/app/[locale]/attestation/kiosk/page.tsx` (create) — fullscreen take-test flow.
- `admin/app/[locale]/attestation/analytics/page.tsx` (create) — dashboard.
- `admin/messages/{en,ru,uz-Latn,uz-Cyrl}.json` (modify) — i18n keys.

---

## Task 1: Schema — enums + 6 tables + migration

**Files:**
- Modify: `backend/drizzle/schema.ts` (append enums near line 52; append tables at end of file)

**Interfaces:**
- Produces (Drizzle tables importable as `import { employees, attestation_tests, attestation_test_questions, attestation_test_question_options, attestation_test_attempts, attestation_test_attempt_answers } from "backend/drizzle/schema"`):
  - `employees`: `{ id, first_name, last_name, position, terminal_id, pin_hash, external_id, active, created_at, updated_at }`
  - `attestation_tests`: `{ id, title, description, passing_score, time_limit_minutes, questions_per_attempt, shuffle_questions, shuffle_options, valid_months, active, created_at, updated_at }`
  - `attestation_test_questions`: `{ id, test_id, text, type, explanation, sort, active }`
  - `attestation_test_question_options`: `{ id, question_id, text, is_correct, sort }`
  - `attestation_test_attempts`: `{ id, test_id, employee_id, terminal_id, launched_by_user_id, started_at, submitted_at, status, score, passed, expires_at, question_ids, created_at }`
  - `attestation_test_attempt_answers`: `{ id, attempt_id, question_id, question_text, selected_option_ids, is_correct }`

- [ ] **Step 1: Add enums**

Append after the existing `pgEnum` block (around line 52) in `backend/drizzle/schema.ts`:

```ts
export const attestation_question_type = pgEnum("attestation_question_type", [
  "single",
  "multi",
]);
export const attestation_attempt_status = pgEnum("attestation_attempt_status", [
  "in_progress",
  "submitted",
  "expired",
]);
```

- [ ] **Step 2: Add the 6 tables**

Append at the end of `backend/drizzle/schema.ts`:

```ts
export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  first_name: varchar("first_name", { length: 100 }).notNull(),
  last_name: varchar("last_name", { length: 100 }).notNull(),
  position: varchar("position", { length: 150 }),
  terminal_id: uuid("terminal_id").notNull(),
  pin_hash: text("pin_hash"),
  external_id: varchar("external_id", { length: 100 }),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_tests = pgTable("attestation_tests", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  passing_score: integer("passing_score").default(80).notNull(),
  time_limit_minutes: integer("time_limit_minutes"),
  questions_per_attempt: integer("questions_per_attempt"),
  shuffle_questions: boolean("shuffle_questions").default(true).notNull(),
  shuffle_options: boolean("shuffle_options").default(true).notNull(),
  valid_months: integer("valid_months"),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_test_questions = pgTable("attestation_test_questions", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  test_id: uuid("test_id").notNull(),
  text: text("text").notNull(),
  type: attestation_question_type("type").default("single").notNull(),
  explanation: text("explanation"),
  sort: integer("sort").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});

export const attestation_test_question_options = pgTable(
  "attestation_test_question_options",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    question_id: uuid("question_id").notNull(),
    text: text("text").notNull(),
    is_correct: boolean("is_correct").default(false).notNull(),
    sort: integer("sort").default(0).notNull(),
  }
);

export const attestation_test_attempts = pgTable("attestation_test_attempts", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  test_id: uuid("test_id").notNull(),
  employee_id: uuid("employee_id").notNull(),
  terminal_id: uuid("terminal_id").notNull(),
  launched_by_user_id: uuid("launched_by_user_id").notNull(),
  started_at: timestamp("started_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  submitted_at: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  status: attestation_attempt_status("status").default("in_progress").notNull(),
  score: integer("score"),
  passed: boolean("passed"),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  question_ids: jsonb("question_ids").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_test_attempt_answers = pgTable(
  "attestation_test_attempt_answers",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    attempt_id: uuid("attempt_id").notNull(),
    question_id: uuid("question_id").notNull(),
    question_text: text("question_text").notNull(),
    selected_option_ids: jsonb("selected_option_ids").notNull(),
    is_correct: boolean("is_correct").default(false).notNull(),
  }
);
```

- [ ] **Step 3: Generate the migration**

Run from `backend/`: `drizzle-kit generate`
Expected: a new `drizzle/migrations/NNNN_*.sql` file creating the 3 enum types and 6 tables. Open it and confirm it only ADDS objects (no DROP on existing tables).

- [ ] **Step 4: Apply the migration**

Run from `backend/`: `drizzle-kit migrate`
Expected: "migrations applied" with no error. Verify in psql: `\dt attestation_*` and `\dt employees` list the 6 tables.

- [ ] **Step 5: Commit**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations
git commit -m "feat(attestation): add employees + attestation test schema"
```

---

## Task 2: Pure grading + sampling module (unit-tested)

This isolates the security-critical, deterministic logic so it can be unit-tested without a DB.

**Files:**
- Create: `backend/src/modules/attestation/grading.ts`
- Test: `backend/src/modules/attestation/grading.test.ts`

**Interfaces:**
- Produces:
  - `type GradableQuestion = { id: string; type: "single" | "multi"; correctOptionIds: string[] }`
  - `gradeAnswer(q: GradableQuestion, selected: string[]): boolean` — a question is correct iff the selected set equals the correct set exactly.
  - `gradeAttempt(questions: GradableQuestion[], answers: Record<string, string[]>): { score: number; correctCount: number }` — `score` = round(correct/total*100); 0 total → score 0.
  - `pickQuestionIds(allIds: string[], n: number | null, rng: () => number): string[]` — Fisher–Yates shuffle via `rng`, take first `n` (all when `n` null/≥length).
  - `shuffleWithRng<T>(arr: T[], rng: () => number): T[]` — pure Fisher–Yates copy.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/attestation/grading.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { gradeAnswer, gradeAttempt, pickQuestionIds, shuffleWithRng } from "./grading";

const single = { id: "q1", type: "single" as const, correctOptionIds: ["a"] };
const multi = { id: "q2", type: "multi" as const, correctOptionIds: ["a", "b"] };

describe("gradeAnswer", () => {
  it("single: correct when exact match", () => {
    expect(gradeAnswer(single, ["a"])).toBe(true);
  });
  it("single: wrong when different option", () => {
    expect(gradeAnswer(single, ["b"])).toBe(false);
  });
  it("multi: correct only when the set matches exactly", () => {
    expect(gradeAnswer(multi, ["b", "a"])).toBe(true);
    expect(gradeAnswer(multi, ["a"])).toBe(false);
    expect(gradeAnswer(multi, ["a", "b", "c"])).toBe(false);
  });
  it("empty selection is wrong", () => {
    expect(gradeAnswer(single, [])).toBe(false);
  });
});

describe("gradeAttempt", () => {
  it("scores percentage rounded", () => {
    const r = gradeAttempt([single, multi], { q1: ["a"], q2: ["a"] });
    expect(r.correctCount).toBe(1);
    expect(r.score).toBe(50);
  });
  it("missing answer counts wrong", () => {
    const r = gradeAttempt([single], {});
    expect(r.score).toBe(0);
  });
  it("empty test scores 0 without dividing by zero", () => {
    expect(gradeAttempt([], {}).score).toBe(0);
  });
});

describe("pickQuestionIds / shuffle", () => {
  const rng = () => 0; // deterministic
  it("returns all when n is null", () => {
    expect(pickQuestionIds(["a", "b", "c"], null, rng).sort()).toEqual(["a", "b", "c"]);
  });
  it("returns n items when n < length", () => {
    expect(pickQuestionIds(["a", "b", "c"], 2, rng)).toHaveLength(2);
  });
  it("shuffleWithRng does not mutate input", () => {
    const input = ["a", "b", "c"];
    shuffleWithRng(input, rng);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `backend/`: `bun test src/modules/attestation/grading.test.ts`
Expected: FAIL — "Cannot find module './grading'".

- [ ] **Step 3: Implement `grading.ts`**

Create `backend/src/modules/attestation/grading.ts`:

```ts
export type GradableQuestion = {
  id: string;
  type: "single" | "multi";
  correctOptionIds: string[];
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function gradeAnswer(q: GradableQuestion, selected: string[]): boolean {
  if (!selected || selected.length === 0) return false;
  return sameSet([...new Set(selected)], [...new Set(q.correctOptionIds)]);
}

export function gradeAttempt(
  questions: GradableQuestion[],
  answers: Record<string, string[]>
): { score: number; correctCount: number } {
  if (questions.length === 0) return { score: 0, correctCount: 0 };
  let correctCount = 0;
  for (const q of questions) {
    if (gradeAnswer(q, answers[q.id] ?? [])) correctCount++;
  }
  return {
    score: Math.round((correctCount / questions.length) * 100),
    correctCount,
  };
}

export function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickQuestionIds(
  allIds: string[],
  n: number | null,
  rng: () => number
): string[] {
  const shuffled = shuffleWithRng(allIds, rng);
  if (n == null || n >= shuffled.length) return shuffled;
  return shuffled.slice(0, n);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `backend/`: `bun test src/modules/attestation/grading.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/attestation/grading.ts backend/src/modules/attestation/grading.test.ts
git commit -m "feat(attestation): pure grading + question-sampling logic with tests"
```

---

## Task 3: Controller scaffold + tests CRUD + registration

**Files:**
- Create: `backend/src/modules/attestation/controller.ts`
- Modify: `backend/src/controllers.ts`

**Interfaces:**
- Consumes: `ctx` from `@backend/context`; `attestation_tests` table.
- Produces: `export const attestationController` (Elysia plugin `@api/attestation`) with routes `GET/POST /attestation/tests`, `GET/PUT/DELETE /attestation/tests/:id`.

- [ ] **Step 1: Create controller with tests CRUD**

Create `backend/src/modules/attestation/controller.ts`:

```ts
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { attestation_tests } from "backend/drizzle/schema";
import { and, eq, sql, SQLWrapper, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const attestationController = new Elysia({
  name: "@api/attestation",
})
  .use(ctx)
  // ---- tests ----
  .get(
    "/attestation/tests",
    async ({ query: { limit, offset, sort, filters, fields }, drizzle }) => {
      let selectFields: SelectedFields = {};
      if (fields) selectFields = parseSelectFields(fields, attestation_tests, {});
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) whereClause = parseFilterFields(filters, attestation_tests, {});
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(attestation_tests)
        .where(and(...whereClause))
        .execute();
      const rows = (await drizzle
        .select(selectFields)
        .from(attestation_tests)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof attestation_tests>[];
      return { total: count[0].count, data: rows };
    },
    {
      permission: "tests.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/tests/:id",
    async ({ params: { id }, set, drizzle }) => {
      const row = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, id))
        .execute();
      if (!row.length) {
        set.status = 404;
        return { message: "Test not found" };
      }
      return row[0];
    },
    { permission: "tests.one", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/tests",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_tests)
        .values(data)
        .returning({ id: attestation_tests.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.add",
      body: t.Object({
        data: t.Object({
          title: t.String(),
          description: t.Optional(t.Nullable(t.String())),
          passing_score: t.Optional(t.Number()),
          time_limit_minutes: t.Optional(t.Nullable(t.Number())),
          questions_per_attempt: t.Optional(t.Nullable(t.Number())),
          shuffle_questions: t.Optional(t.Boolean()),
          shuffle_options: t.Optional(t.Boolean()),
          valid_months: t.Optional(t.Nullable(t.Number())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/attestation/tests/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_tests)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(attestation_tests.id, id))
        .returning({ id: attestation_tests.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          title: t.Optional(t.String()),
          description: t.Optional(t.Nullable(t.String())),
          passing_score: t.Optional(t.Number()),
          time_limit_minutes: t.Optional(t.Nullable(t.Number())),
          questions_per_attempt: t.Optional(t.Nullable(t.Number())),
          shuffle_questions: t.Optional(t.Boolean()),
          shuffle_options: t.Optional(t.Boolean()),
          valid_months: t.Optional(t.Nullable(t.Number())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/tests/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(attestation_tests)
        .where(eq(attestation_tests.id, id))
        .returning({ id: attestation_tests.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.delete", params: t.Object({ id: t.String() }) }
  );
```

- [ ] **Step 2: Register the controller**

In `backend/src/controllers.ts`, add the import after the other module imports (near line 43):

```ts
import { attestationController } from "./modules/attestation/controller";
```

and add to the `.use(...)` chain before the final `.use(asraboxStockController);`:

```ts
  .use(attestationController)
```

- [ ] **Step 3: Verify the server boots and routes mount**

Run from `backend/`: `bun run --watch src/index.ts` (leave running in a second shell).
Then, with a logged-in session cookie for a role holding `tests.list`, call:
`curl -s -b "sessionId=<id>" "http://localhost:3000/api/attestation/tests?limit=10&offset=0" | head`
Expected: `{"total":"0","data":[]}` (200). Without the permission: 403. Without a session: 401.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts backend/src/controllers.ts
git commit -m "feat(attestation): tests CRUD endpoints + module registration"
```

---

## Task 4: Question-bank CRUD (questions + options)

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Consumes: `attestation_test_questions`, `attestation_test_question_options` tables.
- Produces: `GET /attestation/tests/:testId/questions` (returns questions WITH options, including `is_correct` — this is an AUTHORING endpoint behind `tests.edit`, never the take-test endpoint), `POST /attestation/questions`, `PUT /attestation/questions/:id`, `DELETE /attestation/questions/:id`, `POST /attestation/options`, `PUT /attestation/options/:id`, `DELETE /attestation/options/:id`.

- [ ] **Step 1: Add imports**

At the top of `controller.ts`, extend the schema import:

```ts
import {
  attestation_tests,
  attestation_test_questions,
  attestation_test_question_options,
} from "backend/drizzle/schema";
import { and, asc, eq, inArray, sql, SQLWrapper, InferSelectModel } from "drizzle-orm";
```

- [ ] **Step 2: Add the question + option routes**

Chain these before the final `;` of the controller (i.e. convert the trailing `;` on the last `.delete(...)` into continued chaining):

```ts
  // ---- authoring: questions with options ----
  .get(
    "/attestation/tests/:testId/questions",
    async ({ params: { testId }, drizzle }) => {
      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(eq(attestation_test_questions.test_id, testId))
        .orderBy(asc(attestation_test_questions.sort))
        .execute();
      const qIds = questions.map((q) => q.id);
      const options = qIds.length
        ? await drizzle
            .select()
            .from(attestation_test_question_options)
            .where(inArray(attestation_test_question_options.question_id, qIds))
            .orderBy(asc(attestation_test_question_options.sort))
            .execute()
        : [];
      return {
        data: questions.map((q) => ({
          ...q,
          options: options.filter((o) => o.question_id === q.id),
        })),
      };
    },
    { permission: "tests.edit", params: t.Object({ testId: t.String() }) }
  )
  .post(
    "/attestation/questions",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_test_questions)
        .values(data)
        .returning({ id: attestation_test_questions.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.edit",
      body: t.Object({
        data: t.Object({
          test_id: t.String(),
          text: t.String(),
          type: t.Optional(t.Union([t.Literal("single"), t.Literal("multi")])),
          explanation: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/attestation/questions/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_test_questions)
        .set(data)
        .where(eq(attestation_test_questions.id, id))
        .returning({ id: attestation_test_questions.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          text: t.Optional(t.String()),
          type: t.Optional(t.Union([t.Literal("single"), t.Literal("multi")])),
          explanation: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/questions/:id",
    async ({ params: { id }, drizzle }) => {
      await drizzle
        .delete(attestation_test_question_options)
        .where(eq(attestation_test_question_options.question_id, id))
        .execute();
      const deleted = await drizzle
        .delete(attestation_test_questions)
        .where(eq(attestation_test_questions.id, id))
        .returning({ id: attestation_test_questions.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/options",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_test_question_options)
        .values(data)
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.edit",
      body: t.Object({
        data: t.Object({
          question_id: t.String(),
          text: t.String(),
          is_correct: t.Optional(t.Boolean()),
          sort: t.Optional(t.Number()),
        }),
      }),
    }
  )
  .put(
    "/attestation/options/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_test_question_options)
        .set(data)
        .where(eq(attestation_test_question_options.id, id))
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          text: t.Optional(t.String()),
          is_correct: t.Optional(t.Boolean()),
          sort: t.Optional(t.Number()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/options/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(attestation_test_question_options)
        .where(eq(attestation_test_question_options.id, id))
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
  );
```

- [ ] **Step 3: Verify**

With the server running and a `tests.edit`-holding session: create a test (Task 3 POST), then POST a question with that `test_id`, POST two options (one `is_correct: true`), then `GET /api/attestation/tests/:testId/questions`.
Expected: one question object with an `options` array of 2, correct flag present (authoring view).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(attestation): question-bank authoring CRUD"
```

---

## Task 5: Employees CRUD with PIN hashing + terminal scoping

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Consumes: `employees` table; `user`, `terminals` from context; `Bun.password`.
- Produces: `GET /attestation/employees` (scoped list, `pin_hash` stripped), `GET /attestation/employees/:id` (stripped), `POST /attestation/employees` (hashes `pin` → `pin_hash`), `PUT /attestation/employees/:id` (re-hashes `pin` when provided), `DELETE /attestation/employees/:id`.
- Rule: non-HQ callers only see/mutate employees whose `terminal_id ∈ terminals`.

- [ ] **Step 1: Add the employees import + a strip helper**

Extend the schema import to include `employees`. Add near the top of the file (after imports):

```ts
// Never leak the PIN hash to any client.
function stripPin<T extends { pin_hash?: unknown }>(row: T): Omit<T, "pin_hash"> {
  const { pin_hash, ...rest } = row;
  return rest;
}
```

- [ ] **Step 2: Add the employee routes**

Chain onto the controller (same continuation pattern as Task 4):

```ts
  // ---- employees roster ----
  .get(
    "/attestation/employees",
    async ({ query: { limit, offset }, user, terminals, drizzle }) => {
      const isHQ = user?.is_super_user === true;
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
    {
      permission: "employees.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/employees/:id",
    async ({ params: { id }, user, terminals, set, drizzle }) => {
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
      const isHQ = user?.is_super_user === true;
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      return stripPin(emp);
    },
    { permission: "employees.one", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/employees",
    async ({ body: { data }, drizzle }) => {
      const { pin, ...rest } = data;
      const pin_hash = pin ? await Bun.password.hash(pin) : null;
      const inserted = await drizzle
        .insert(employees)
        .values({ ...rest, pin_hash })
        .returning({ id: employees.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "employees.add",
      body: t.Object({
        data: t.Object({
          first_name: t.String(),
          last_name: t.String(),
          position: t.Optional(t.Nullable(t.String())),
          terminal_id: t.String(),
          external_id: t.Optional(t.Nullable(t.String())),
          active: t.Optional(t.Boolean()),
          pin: t.Optional(t.String()),
        }),
      }),
    }
  )
  .put(
    "/attestation/employees/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const { pin, ...rest } = data;
      const patch: Record<string, unknown> = {
        ...rest,
        updated_at: new Date().toISOString(),
      };
      if (pin) patch.pin_hash = await Bun.password.hash(pin);
      const updated = await drizzle
        .update(employees)
        .set(patch)
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return updated[0];
    },
    {
      permission: "employees.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          first_name: t.Optional(t.String()),
          last_name: t.Optional(t.String()),
          position: t.Optional(t.Nullable(t.String())),
          terminal_id: t.Optional(t.String()),
          external_id: t.Optional(t.Nullable(t.String())),
          active: t.Optional(t.Boolean()),
          pin: t.Optional(t.String()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/employees/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(employees)
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return deleted[0];
    },
    { permission: "employees.delete", params: t.Object({ id: t.String() }) }
  );
```

- [ ] **Step 3: Verify PIN never leaks + scoping works**

With a `employees.add` session: POST an employee with `pin: "1234"` and a `terminal_id` in your scope. Then `GET /api/attestation/employees` and `GET /api/attestation/employees/:id`.
Expected: responses contain `first_name` etc. but **no `pin_hash`** field. As a non-HQ user, GET on an employee from a terminal outside your `terminals` returns 403.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(attestation): employees CRUD with hashed PIN + terminal scoping"
```

---

## Task 6: Start-attempt endpoint (PIN verify, sampling, sanitize)

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Consumes: `attestation_tests`, `attestation_test_questions`, `attestation_test_question_options`, `attestation_test_attempts`, `employees`; `gradeAttempt`/`pickQuestionIds`/`shuffleWithRng` from `./grading`; `user`, `terminals`.
- Produces: `POST /attestation/attempts/start` with body `{ data: { test_id, employee_id, terminal_id, pin } }`. Returns `{ attempt_id, started_at, time_limit_minutes, questions: [{ id, text, type, options: [{ id, text }] }] }` — **no `is_correct`**. Enforces: employee active + in scope, correct PIN (argon2 verify), no existing live attempt, samples `questions_per_attempt`, shuffles per test flags.

- [ ] **Step 1: Add imports**

Extend the schema import to include `attestation_test_attempts`. Add:

```ts
import { pickQuestionIds, shuffleWithRng } from "./grading";
```

- [ ] **Step 2: Add the start route**

Chain onto the controller:

```ts
  // ---- take test: start ----
  .post(
    "/attestation/attempts/start",
    async ({ body: { data }, user, terminals, set, drizzle }) => {
      const { test_id, employee_id, terminal_id, pin } = data;

      // employee must exist, be active, and be in the manager's scope
      const empRows = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, employee_id))
        .execute();
      if (!empRows.length || !empRows[0].active) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = empRows[0];
      const isHQ = user?.is_super_user === true;
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }

      // PIN check (argon2 verify). No PIN set → cannot take.
      if (!emp.pin_hash) {
        set.status = 400;
        return { message: "Employee has no PIN set" };
      }
      const pinOk = await Bun.password.verify(pin, emp.pin_hash);
      if (!pinOk) {
        set.status = 401;
        return { message: "Invalid PIN" };
      }

      // reject if a live (in_progress or submitted-not-expired) attempt exists
      const existing = await drizzle
        .select({
          id: attestation_test_attempts.id,
          status: attestation_test_attempts.status,
          passed: attestation_test_attempts.passed,
          expires_at: attestation_test_attempts.expires_at,
        })
        .from(attestation_test_attempts)
        .where(
          and(
            eq(attestation_test_attempts.test_id, test_id),
            eq(attestation_test_attempts.employee_id, employee_id)
          )
        )
        .execute();
      const nowIso = new Date().toISOString();
      const blocking = existing.find(
        (a) =>
          a.status === "in_progress" ||
          (a.status === "submitted" &&
            (a.expires_at == null || a.expires_at > nowIso))
      );
      if (blocking) {
        set.status = 409;
        return {
          message: "An attempt already exists for this test",
          attempt_id: blocking.id,
        };
      }

      // load test + active questions
      const testRows = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, test_id))
        .execute();
      if (!testRows.length || !testRows[0].active) {
        set.status = 404;
        return { message: "Test not found" };
      }
      const test = testRows[0];

      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(
          and(
            eq(attestation_test_questions.test_id, test_id),
            eq(attestation_test_questions.active, true)
          )
        )
        .execute();
      if (!questions.length) {
        set.status = 400;
        return { message: "Test has no questions" };
      }

      // sample + shuffle (non-crypto RNG is fine here; not a secret)
      const rng = Math.random;
      const pickedIds = pickQuestionIds(
        questions.map((q) => q.id),
        test.questions_per_attempt,
        rng
      );
      const orderedIds = test.shuffle_questions
        ? shuffleWithRng(pickedIds, rng)
        : pickedIds;

      const options = await drizzle
        .select()
        .from(attestation_test_question_options)
        .where(inArray(attestation_test_question_options.question_id, orderedIds))
        .execute();

      const created = await drizzle
        .insert(attestation_test_attempts)
        .values({
          test_id,
          employee_id,
          terminal_id,
          launched_by_user_id: user!.id,
          status: "in_progress",
          question_ids: orderedIds,
        })
        .returning({
          id: attestation_test_attempts.id,
          started_at: attestation_test_attempts.started_at,
        })
        .execute();

      const qById = new Map(questions.map((q) => [q.id, q]));
      const sanitizedQuestions = orderedIds.map((qid) => {
        const q = qById.get(qid)!;
        const opts = options
          .filter((o) => o.question_id === qid)
          .map((o) => ({ id: o.id, text: o.text })); // NO is_correct
        return {
          id: q.id,
          text: q.text,
          type: q.type,
          options: test.shuffle_options ? shuffleWithRng(opts, rng) : opts,
        };
      });

      return {
        attempt_id: created[0].id,
        started_at: created[0].started_at,
        time_limit_minutes: test.time_limit_minutes,
        questions: sanitizedQuestions,
      };
    },
    {
      permission: "attestation.run",
      body: t.Object({
        data: t.Object({
          test_id: t.String(),
          employee_id: t.String(),
          terminal_id: t.String(),
          pin: t.String(),
        }),
      }),
    }
  );
```

- [ ] **Step 3: Verify sanitization + PIN gate**

With an `attestation.run` session, a test with questions/options, and an employee with PIN `1234`:
- POST start with wrong pin → 401.
- POST start with `pin: "1234"` → 200; inspect JSON: every option has `{id,text}` and **no `is_correct`**; `questions` length ≤ `questions_per_attempt`.
- POST start again (same employee/test) → 409.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(attestation): start-attempt with PIN verify, sampling, sanitized payload"
```

---

## Task 7: Submit-attempt endpoint (server grade, snapshot, expiry, timer)

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Consumes: `attestation_test_attempts`, `attestation_test_questions`, `attestation_test_question_options`, `attestation_test_attempt_answers`, `attestation_tests`; `gradeAttempt`, `GradableQuestion` from `./grading`.
- Produces: `POST /attestation/attempts/:id/submit` with body `{ data: { answers: Array<{ question_id, selected_option_ids }> } }`. Grades server-side over the attempt's frozen `question_ids`, writes answer snapshots, sets `score/passed/expires_at/status`, and marks `expired` if past the time limit.

- [ ] **Step 1: Add imports**

Extend the schema import with `attestation_test_attempt_answers`. Add:

```ts
import { gradeAttempt, type GradableQuestion } from "./grading";
```

- [ ] **Step 2: Add the submit route**

Chain onto the controller:

```ts
  // ---- take test: submit ----
  .post(
    "/attestation/attempts/:id/submit",
    async ({ params: { id }, body: { data }, set, drizzle }) => {
      const attemptRows = await drizzle
        .select()
        .from(attestation_test_attempts)
        .where(eq(attestation_test_attempts.id, id))
        .execute();
      if (!attemptRows.length) {
        set.status = 404;
        return { message: "Attempt not found" };
      }
      const attempt = attemptRows[0];
      if (attempt.status !== "in_progress") {
        set.status = 409;
        return { message: "Attempt already finalized" };
      }

      const test = (
        await drizzle
          .select()
          .from(attestation_tests)
          .where(eq(attestation_tests.id, attempt.test_id))
          .execute()
      )[0];

      // authoritative server-side timer
      const nowMs = Date.now();
      const startedMs = new Date(attempt.started_at).getTime();
      const overTime =
        test.time_limit_minutes != null &&
        nowMs > startedMs + test.time_limit_minutes * 60_000;

      const questionIds = attempt.question_ids as string[];
      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(inArray(attestation_test_questions.id, questionIds))
        .execute();
      const options = await drizzle
        .select()
        .from(attestation_test_question_options)
        .where(inArray(attestation_test_question_options.question_id, questionIds))
        .execute();

      const gradable: GradableQuestion[] = questions.map((q) => ({
        id: q.id,
        type: q.type as "single" | "multi",
        correctOptionIds: options
          .filter((o) => o.question_id === q.id && o.is_correct)
          .map((o) => o.id),
      }));

      const answerMap: Record<string, string[]> = {};
      for (const a of data.answers) {
        answerMap[a.question_id] = a.selected_option_ids;
      }

      const { score } = gradeAttempt(gradable, answerMap);
      const passed = !overTime && score >= test.passing_score;
      const nowIso = new Date().toISOString();
      const expires_at =
        passed && test.valid_months != null
          ? new Date(nowMs + test.valid_months * 30 * 24 * 60 * 60_000).toISOString()
          : null;

      // snapshot answers
      const qTextById = new Map(questions.map((q) => [q.id, q.text]));
      const gradableById = new Map(gradable.map((g) => [g.id, g]));
      const snapshotRows = questionIds.map((qid) => {
        const selected = answerMap[qid] ?? [];
        const g = gradableById.get(qid)!;
        return {
          attempt_id: id,
          question_id: qid,
          question_text: qTextById.get(qid) ?? "",
          selected_option_ids: selected,
          is_correct:
            selected.length > 0 &&
            selected.length === g.correctOptionIds.length &&
            selected.every((s) => g.correctOptionIds.includes(s)),
        };
      });
      if (snapshotRows.length) {
        await drizzle
          .insert(attestation_test_attempt_answers)
          .values(snapshotRows)
          .execute();
      }

      await drizzle
        .update(attestation_test_attempts)
        .set({
          status: overTime ? "expired" : "submitted",
          submitted_at: nowIso,
          score,
          passed,
          expires_at,
        })
        .where(eq(attestation_test_attempts.id, id))
        .execute();

      return { attempt_id: id, score, passed, expired: overTime };
    },
    {
      permission: "attestation.run",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          answers: t.Array(
            t.Object({
              question_id: t.String(),
              selected_option_ids: t.Array(t.String()),
            })
          ),
        }),
      }),
    }
  );
```

- [ ] **Step 3: Verify grading + finalization**

Start an attempt (Task 6), submit with the correct options for each question.
Expected: `{ score: 100, passed: true, expired: false }`; a second submit → 409; `attestation_test_attempt_answers` has one row per question with `is_correct` set; the attempt row has `status='submitted'`, `expires_at` set when the test has `valid_months`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(attestation): submit-attempt with server grading, snapshots, timer, expiry"
```

---

## Task 8: HQ reset + analytics endpoints

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts`

**Interfaces:**
- Produces:
  - `POST /attestation/attempts/:id/reset` (`attestation.reset`) — sets the attempt's `status='expired'` so the employee can retake.
  - `GET /attestation/analytics/attempts` (`attestation.analytics`) — scoped attempts joined to employee + test names, filterable by `terminal_id`, `test_id`, `passed`, `status`.
  - `GET /attestation/analytics/summary` (`attestation.analytics`) — counts: total attempts, passed, failed, pass-rate %, expiring-soon (next 30 days).

- [ ] **Step 1: Add reset route**

```ts
  // ---- HQ retake reset ----
  .post(
    "/attestation/attempts/:id/reset",
    async ({ params: { id }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_test_attempts)
        .set({ status: "expired" })
        .where(eq(attestation_test_attempts.id, id))
        .returning({ id: attestation_test_attempts.id })
        .execute();
      return updated[0];
    },
    { permission: "attestation.reset", params: t.Object({ id: t.String() }) }
  );
```

- [ ] **Step 2: Add analytics routes**

```ts
  // ---- analytics ----
  .get(
    "/attestation/analytics/attempts",
    async ({ query, user, terminals, drizzle }) => {
      const isHQ = user?.is_super_user === true;
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) where.push(inArray(attestation_test_attempts.terminal_id, terminals));
      if (query.terminal_id)
        where.push(eq(attestation_test_attempts.terminal_id, query.terminal_id));
      if (query.test_id)
        where.push(eq(attestation_test_attempts.test_id, query.test_id));
      if (query.passed != null)
        where.push(eq(attestation_test_attempts.passed, query.passed === "true"));
      const rows = await drizzle
        .select({
          id: attestation_test_attempts.id,
          test_id: attestation_test_attempts.test_id,
          test_title: attestation_tests.title,
          employee_id: attestation_test_attempts.employee_id,
          first_name: employees.first_name,
          last_name: employees.last_name,
          terminal_id: attestation_test_attempts.terminal_id,
          status: attestation_test_attempts.status,
          score: attestation_test_attempts.score,
          passed: attestation_test_attempts.passed,
          submitted_at: attestation_test_attempts.submitted_at,
          expires_at: attestation_test_attempts.expires_at,
        })
        .from(attestation_test_attempts)
        .leftJoin(employees, eq(employees.id, attestation_test_attempts.employee_id))
        .leftJoin(
          attestation_tests,
          eq(attestation_tests.id, attestation_test_attempts.test_id)
        )
        .where(and(...where))
        .limit(+(query.limit ?? "50"))
        .offset(+(query.offset ?? "0"))
        .execute();
      return { data: rows };
    },
    {
      permission: "attestation.analytics",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        test_id: t.Optional(t.String()),
        passed: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/analytics/summary",
    async ({ user, terminals, drizzle }) => {
      const isHQ = user?.is_super_user === true;
      const scope = isHQ ? [] : [inArray(attestation_test_attempts.terminal_id, terminals)];
      const soonIso = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      const nowIso = new Date().toISOString();
      const agg = await drizzle
        .select({
          total: sql<number>`count(*)`,
          passed: sql<number>`count(*) filter (where ${attestation_test_attempts.passed} = true)`,
          failed: sql<number>`count(*) filter (where ${attestation_test_attempts.passed} = false)`,
          expiring_soon: sql<number>`count(*) filter (where ${attestation_test_attempts.expires_at} between ${nowIso} and ${soonIso})`,
        })
        .from(attestation_test_attempts)
        .where(and(...scope))
        .execute();
      const a = agg[0];
      const total = Number(a.total);
      return {
        total,
        passed: Number(a.passed),
        failed: Number(a.failed),
        expiring_soon: Number(a.expiring_soon),
        pass_rate: total ? Math.round((Number(a.passed) / total) * 100) : 0,
      };
    },
    { permission: "attestation.analytics" }
  );
```

- [ ] **Step 3: Verify**

With an `attestation.analytics` session: `GET /api/attestation/analytics/summary` → `{ total, passed, failed, pass_rate, expiring_soon }`. `GET /api/attestation/analytics/attempts` → rows include `first_name`, `test_title`. As a non-HQ manager, only own-terminal attempts appear. With `attestation.reset`: reset an attempt, then re-start it (Task 6) → now allowed (no 409).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(attestation): HQ reset + scoped analytics endpoints"
```

---

## Task 9: Seed permission slugs

**Files:**
- Create: `backend/src/modules/attestation/seed-permissions.ts`

**Interfaces:**
- Produces: a runnable script that idempotently inserts the attestation permission slugs into `permissions`.

- [ ] **Step 1: Write the seeder**

Create `backend/src/modules/attestation/seed-permissions.ts`:

```ts
import { drizzle as drizzleClient } from "../../lib/db"; // adjust if the db export differs
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "tests.list", description: "Attestation: list tests" },
  { slug: "tests.one", description: "Attestation: view a test" },
  { slug: "tests.add", description: "Attestation: create test" },
  { slug: "tests.edit", description: "Attestation: edit test + questions" },
  { slug: "tests.delete", description: "Attestation: delete test" },
  { slug: "employees.list", description: "Attestation: list employees" },
  { slug: "employees.one", description: "Attestation: view employee" },
  { slug: "employees.add", description: "Attestation: create employee" },
  { slug: "employees.edit", description: "Attestation: edit employee" },
  { slug: "employees.delete", description: "Attestation: delete employee" },
  { slug: "attestation.run", description: "Attestation: launch + take tests (kiosk)" },
  { slug: "attestation.reset", description: "Attestation: reset an attempt (HQ)" },
  { slug: "attestation.analytics", description: "Attestation: view analytics" },
  { slug: "attestation_layout", description: "Attestation: top-level admin layout" },
];

async function main() {
  for (const s of SLUGS) {
    const existing = await drizzleClient
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.slug, s.slug))
      .execute();
    if (existing.length) {
      console.log(`skip ${s.slug} (exists)`);
      continue;
    }
    await drizzleClient
      .insert(permissions)
      .values({ slug: s.slug, description: s.description, active: true })
      .execute();
    console.log(`inserted ${s.slug}`);
  }
  console.log("done");
  process.exit(0);
}

main();
```

Note: confirm the drizzle client import path — grep `backend/src/lib` for the exported db instance (the modules obtain `drizzle` from `ctx`, but a standalone script needs the raw client). Match whatever `backend/src/lib/db.ts` (or equivalent) exports.

- [ ] **Step 2: Run the seeder**

Run from `backend/`: `bun run src/modules/attestation/seed-permissions.ts`
Expected: 14 "inserted" lines the first run; "skip … (exists)" on a second run (idempotent).

- [ ] **Step 3: Assign to a role**

In the admin UI (System → Roles) or via SQL, attach the new slugs to the role(s) you want: give branch/manager roles `attestation.run` (+ `employees.*` if managers manage their roster), and an HQ role `tests.*`, `attestation.reset`, `attestation.analytics`, `attestation_layout`. After changing role permissions, the cache refreshes on next login / cache rebuild.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/attestation/seed-permissions.ts
git commit -m "feat(attestation): permission-slug seeder"
```

---

## Task 10: Admin layout gate

**Files:**
- Create: `admin/components/layout/attestation-layout.tsx`
- Modify: `admin/components/layout/main-layout.tsx`

**Interfaces:**
- Consumes: `CanAccess`.
- Produces: `AttestationLayout` rendered under `<CanAccess permission="attestation_layout">`, with nav links to Tests, Employees, Analytics, Kiosk.

- [ ] **Step 1: Create the layout**

Create `admin/components/layout/attestation-layout.tsx`. Mirror the structure of an existing sibling layout (open `admin/components/layout/manager-layout.tsx` and copy its shell — header/sidebar wrapper — replacing the nav items with the four links below). The nav hrefs (locale is injected by the i18n `Link` from `@admin/i18n/routing`):

```tsx
"use client";
import { Link } from "@admin/i18n/routing";

const navItems = [
  { href: "/attestation/tests", label: "Тесты" },
  { href: "/attestation/employees", label: "Сотрудники" },
  { href: "/attestation/analytics", label: "Аналитика" },
  { href: "/attestation/kiosk", label: "Пройти тест" },
];
// render navItems as <Link href={item.href}>{item.label}</Link> inside the copied shell.
```

- [ ] **Step 2: Wire it into `main-layout.tsx`**

Add the import next to the other layout imports:

```tsx
import AttestationLayout from "./attestation-layout";
```

Add this block alongside the other `<CanAccess>` wrappers (after the `sales_plan_layout` block):

```tsx
      <CanAccess permission="attestation_layout">
        <AttestationLayout>{children}</AttestationLayout>
      </CanAccess>
```

- [ ] **Step 3: Verify**

Log in as a role holding `attestation_layout`. The attestation nav appears; the four links route to `/<locale>/attestation/...`. A role without the slug sees nothing new.

- [ ] **Step 4: Commit**

```bash
git add admin/components/layout/attestation-layout.tsx admin/components/layout/main-layout.tsx
git commit -m "feat(attestation): admin layout gate + nav"
```

---

## Task 11: Tests management pages (list + form)

**Files:**
- Create: `admin/app/[locale]/attestation/tests/page.tsx`
- Create: `admin/app/[locale]/attestation/tests/data-table.tsx`
- Create: `admin/app/[locale]/attestation/tests/columns.tsx`
- Create: `admin/app/[locale]/attestation/tests/delete-action.tsx`
- Create: `admin/components/forms/attestation-test/sheet.tsx`
- Create: `admin/components/forms/attestation-test/_form.tsx`

**Interfaces:**
- Consumes: `apiClient.api.attestation.tests`; `attestation_tests` inferred types.
- Produces: a working tests list with create/edit sheet and delete.

- [ ] **Step 1: Create the sheet wrapper**

Create `admin/components/forms/attestation-test/sheet.tsx` (mirror `admin/components/forms/permissions/sheet.tsx` — open it and copy its structure) rendering `AttestationTestForm` inside a shadcn `Sheet`. The wrapper accepts `{ children, recordId? }`, controls `open` state, and passes `setOpen` + `recordId` to the form. Reuse the exact Sheet/SheetTrigger/SheetContent scaffolding from the permissions sheet.

- [ ] **Step 2: Create the form**

Create `admin/components/forms/attestation-test/_form.tsx`:

```tsx
import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { attestation_tests } from "@backend/../drizzle/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useEffect, useMemo } from "react";

export default function AttestationTestForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  const onDone = (text: string) => {
    toast.success(`Test ${text}`);
    queryClient.invalidateQueries({ queryKey: ["attestation_tests"] });
    setOpen(false);
  };
  const onError = (e: any) => toast.error(e.message);

  const createMutation = useMutation({
    mutationFn: (data: typeof attestation_tests.$inferInsert) =>
      apiClient.api.attestation.tests.post({ data }),
    onSuccess: () => onDone("added"),
    onError,
  });
  const updateMutation = useMutation({
    mutationFn: (p: { data: typeof attestation_tests.$inferInsert; id: string }) =>
      apiClient.api.attestation.tests({ id: p.id }).put({ data: p.data }),
    onSuccess: () => onDone("updated"),
    onError,
  });

  const form = useForm({
    defaultValues: {
      title: "",
      description: "",
      passing_score: 80,
      time_limit_minutes: 15,
      questions_per_attempt: 10,
      shuffle_questions: true,
      shuffle_options: true,
      valid_months: 12,
      active: true,
    },
    onSubmit: async ({ value }) => {
      if (recordId) updateMutation.mutate({ data: value as any, id: recordId });
      else createMutation.mutate(value as any);
    },
  });

  const { data: record } = useQuery({
    queryKey: ["one_attestation_test", recordId],
    queryFn: () =>
      recordId ? apiClient.api.attestation.tests({ id: recordId }).get({}) : null,
    enabled: !!recordId,
  });

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      const r = record.data as any;
      form.setFieldValue("title", r.title ?? "");
      form.setFieldValue("description", r.description ?? "");
      form.setFieldValue("passing_score", r.passing_score ?? 80);
      form.setFieldValue("time_limit_minutes", r.time_limit_minutes ?? 15);
      form.setFieldValue("questions_per_attempt", r.questions_per_attempt ?? 10);
      form.setFieldValue("shuffle_questions", r.shuffle_questions ?? true);
      form.setFieldValue("shuffle_options", r.shuffle_options ?? true);
      form.setFieldValue("valid_months", r.valid_months ?? 12);
      form.setFieldValue("active", r.active ?? true);
    }
  }, [record]);

  const isLoading = useMemo(
    () => createMutation.isPending || updateMutation.isPending,
    [createMutation.isPending, updateMutation.isPending]
  );

  const numberField = (name: string, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <form.Field name={name as any}>
        {(field: any) => (
          <Input
            type="number"
            value={field.state.value}
            onChange={(e) => field.handleChange(Number(e.target.value))}
          />
        )}
      </form.Field>
    </div>
  );

  const switchField = (name: string, label: string) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div>
        <form.Field name={name as any}>
          {(field: any) => (
            <Switch checked={field.getValue()} onCheckedChange={field.setValue} />
          )}
        </form.Field>
      </div>
    </div>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <Label>Название</Label>
        <form.Field name="title">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>
      <div className="space-y-2">
        <Label>Описание</Label>
        <form.Field name="description">
          {(field) => (
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>
      {numberField("passing_score", "Проходной балл (%)")}
      {numberField("time_limit_minutes", "Лимит времени (мин)")}
      {numberField("questions_per_attempt", "Вопросов за попытку")}
      {numberField("valid_months", "Срок действия (мес)")}
      {switchField("shuffle_questions", "Перемешивать вопросы")}
      {switchField("shuffle_options", "Перемешивать ответы")}
      {switchField("active", "Активен")}
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create columns**

Create `admin/app/[locale]/attestation/tests/columns.tsx`:

```tsx
"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, ListChecks } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { Link } from "@admin/i18n/routing";
import DeleteAction from "./delete-action";
import AttestationTestFormSheet from "@admin/components/forms/attestation-test/sheet";
import { attestation_tests } from "@backend/../drizzle/schema";

export const attestationTestColumns: ColumnDef<
  typeof attestation_tests.$inferSelect
>[] = [
  {
    accessorKey: "active",
    header: "Активен",
    cell: ({ row }) => <Switch checked={row.original.active} disabled />,
  },
  { accessorKey: "title", header: "Название" },
  { accessorKey: "passing_score", header: "Проходной %" },
  {
    id: "actions",
    cell: ({ row }) => {
      const record = row.original;
      return (
        <div className="flex items-center space-x-2">
          <Link href={`/attestation/tests/${record.id}/questions`}>
            <Button variant="outline" size="sm">
              <ListChecks className="h-4 w-4" />
            </Button>
          </Link>
          <AttestationTestFormSheet recordId={record.id}>
            <Button variant="outline" size="sm">
              <Edit2Icon className="h-4 w-4" />
            </Button>
          </AttestationTestFormSheet>
          <DeleteAction recordId={record.id} />
        </div>
      );
    },
  },
];
```

- [ ] **Step 4: Create data-table + delete-action + page**

Create `admin/app/[locale]/attestation/tests/data-table.tsx` by copying `admin/app/[locale]/system/permissions/data-table.tsx` verbatim and changing only: the generic type to `typeof attestation_tests.$inferSelect`, the query key to `"attestation_tests"`, the `fields` to `"id,active,title,passing_score"`, and the fetch call to `apiClient.api.attestation.tests.get({ query: {...} })`.

Create `admin/app/[locale]/attestation/tests/delete-action.tsx`:

```tsx
import { DeleteButton } from "@components/ui/delete-button";
import { apiClient } from "@admin/utils/eden";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () => apiClient.api.attestation.tests({ id: recordId }).delete({}),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attestation_tests"] }),
  });
  return <DeleteButton recordId={recordId} deleteRecord={() => del.mutate()} />;
}
```

Create `admin/app/[locale]/attestation/tests/page.tsx`:

```tsx
"use client";
import { DataTable } from "./data-table";
import { attestationTestColumns } from "./columns";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import AttestationTestFormSheet from "@admin/components/forms/attestation-test/sheet";

export default function AttestationTestsPage() {
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Тесты аттестации</h2>
        <AttestationTestFormSheet>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Новый тест
          </Button>
        </AttestationTestFormSheet>
      </div>
      <div className="py-10">
        <DataTable columns={attestationTestColumns} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run `cd admin && bun dev`. Visit `/<locale>/attestation/tests`. Create a test via the sheet → appears in the table; edit → values persist; delete → row disappears. Run `cd admin && bun lint` — no new errors.

- [ ] **Step 6: Commit**

```bash
git add admin/app/[locale]/attestation/tests admin/components/forms/attestation-test
git commit -m "feat(attestation): tests management UI"
```

---

## Task 12: Question-bank editor

**Files:**
- Create: `admin/app/[locale]/attestation/tests/[id]/questions/page.tsx`

**Interfaces:**
- Consumes: `apiClient.api.attestation.tests({id}).questions.get()`, `apiClient.api.attestation.questions`, `apiClient.api.attestation.options`.
- Produces: a page listing a test's questions with inline add/edit/delete of questions and options, and per-option correct toggle.

- [ ] **Step 1: Build the editor page**

Create `admin/app/[locale]/attestation/tests/[id]/questions/page.tsx`:

```tsx
"use client";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Switch } from "@components/ui/switch";
import { Label } from "@components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function QuestionsEditorPage() {
  const params = useParams();
  const testId = params.id as string;
  const qc = useQueryClient();
  const key = ["attestation_questions", testId];

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiClient.api.attestation.tests({ id: testId }).questions.get(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [newQ, setNewQ] = useState("");
  const addQuestion = useMutation({
    mutationFn: () =>
      apiClient.api.attestation.questions.post({
        data: { test_id: testId, text: newQ, type: "single" },
      }),
    onSuccess: () => {
      setNewQ("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delQuestion = useMutation({
    mutationFn: (id: string) => apiClient.api.attestation.questions({ id }).delete({}),
    onSuccess: invalidate,
  });
  const addOption = useMutation({
    mutationFn: (question_id: string) =>
      apiClient.api.attestation.options.post({
        data: { question_id, text: "Новый вариант", is_correct: false },
      }),
    onSuccess: invalidate,
  });
  const toggleCorrect = useMutation({
    mutationFn: (p: { id: string; is_correct: boolean }) =>
      apiClient.api.attestation.options({ id: p.id }).put({
        data: { is_correct: p.is_correct },
      }),
    onSuccess: invalidate,
  });
  const editOptionText = useMutation({
    mutationFn: (p: { id: string; text: string }) =>
      apiClient.api.attestation.options({ id: p.id }).put({ data: { text: p.text } }),
    onSuccess: invalidate,
  });
  const delOption = useMutation({
    mutationFn: (id: string) => apiClient.api.attestation.options({ id }).delete({}),
    onSuccess: invalidate,
  });
  const editQuestion = useMutation({
    mutationFn: (p: { id: string; text?: string; type?: "single" | "multi" }) =>
      apiClient.api.attestation.questions({ id: p.id }).put({
        data: { text: p.text, type: p.type },
      }),
    onSuccess: invalidate,
  });

  const questions = (data as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Вопросы теста</h2>

      <div className="flex gap-2">
        <Input
          placeholder="Текст нового вопроса"
          value={newQ}
          onChange={(e) => setNewQ(e.target.value)}
        />
        <Button onClick={() => addQuestion.mutate()} disabled={!newQ}>
          <Plus className="h-4 w-4 mr-1" /> Вопрос
        </Button>
      </div>

      {questions.map((q: any) => (
        <div key={q.id} className="border rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              defaultValue={q.text}
              onBlur={(e) => editQuestion.mutate({ id: q.id, text: e.target.value })}
            />
            <select
              className="border rounded h-9 px-2"
              defaultValue={q.type}
              onChange={(e) =>
                editQuestion.mutate({ id: q.id, type: e.target.value as any })
              }
            >
              <option value="single">Один ответ</option>
              <option value="multi">Несколько</option>
            </select>
            <Button variant="destructive" size="sm" onClick={() => delQuestion.mutate(q.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 pl-4">
            {q.options.map((o: any) => (
              <div key={o.id} className="flex items-center gap-2">
                <Switch
                  checked={o.is_correct}
                  onCheckedChange={(v) => toggleCorrect.mutate({ id: o.id, is_correct: v })}
                />
                <Input
                  defaultValue={o.text}
                  onBlur={(e) => editOptionText.mutate({ id: o.id, text: e.target.value })}
                />
                <Button variant="ghost" size="sm" onClick={() => delOption.mutate(o.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => addOption.mutate(q.id)}>
              <Plus className="h-4 w-4 mr-1" /> Вариант
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

From the tests list, click the questions icon on a test. Add a question, add 2 options, toggle one correct, edit text (blur to save), delete an option/question. Reload — state persists. `cd admin && bun lint` clean.

- [ ] **Step 3: Commit**

```bash
git add "admin/app/[locale]/attestation/tests/[id]/questions"
git commit -m "feat(attestation): question-bank editor UI"
```

---

## Task 13: Employees roster UI

**Files:**
- Create: `admin/app/[locale]/attestation/employees/{page,data-table,columns,delete-action}.tsx`
- Create: `admin/components/forms/attestation-employee/{sheet,_form}.tsx`

**Interfaces:**
- Consumes: `apiClient.api.attestation.employees`; terminals list for the select (`apiClient.api.terminals` or the existing cached terminals endpoint — grep admin for the existing terminal-select usage and reuse it).
- Produces: employees list + create/edit sheet (name, position, terminal select, active, PIN input) + delete.

- [ ] **Step 1: Create form**

Create `admin/components/forms/attestation-employee/_form.tsx`. Mirror the Task 11 test form structure; fields differ. Key parts:

```tsx
// state fields: first_name, last_name, position, terminal_id, active, pin
// terminal_id -> a <Select> populated from the terminals endpoint the admin
// already uses elsewhere (grep: apiClient.api.terminals ... .get). Copy that
// query, map to <SelectItem value={t.id}>{t.name}</SelectItem>.
//
// PIN field (write-only): render an <Input type="password" placeholder="PIN (оставьте пустым чтобы не менять)">.
// Only include `pin` in the mutation payload when the field is non-empty.

const createMutation = useMutation({
  mutationFn: (data: any) => apiClient.api.attestation.employees.post({ data }),
  onSuccess: () => onDone("added"),
  onError,
});
const updateMutation = useMutation({
  mutationFn: (p: { data: any; id: string }) =>
    apiClient.api.attestation.employees({ id: p.id }).put({ data: p.data }),
  onSuccess: () => onDone("updated"),
  onError,
});
// in onSubmit: build payload = {...value}; if (!payload.pin) delete payload.pin;
// invalidateQueries key: ["attestation_employees"]
```

Full field rendering follows the exact `form.Field` + `Input`/`Switch` idiom from Task 11. The terminal `Select` uses shadcn `Select` (imported from `@components/ui/select`) with `value={field.getValue()}` and `onValueChange={field.setValue}`.

- [ ] **Step 2: Create sheet**

Create `admin/components/forms/attestation-employee/sheet.tsx` mirroring the Task 11 sheet, rendering `AttestationEmployeeForm`.

- [ ] **Step 3: Create columns**

Create `admin/app/[locale]/attestation/employees/columns.tsx`:

```tsx
"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import DeleteAction from "./delete-action";
import AttestationEmployeeFormSheet from "@admin/components/forms/attestation-employee/sheet";
import { employees } from "@backend/../drizzle/schema";

export const attestationEmployeeColumns: ColumnDef<
  typeof employees.$inferSelect
>[] = [
  {
    accessorKey: "active",
    header: "Активен",
    cell: ({ row }) => <Switch checked={row.original.active} disabled />,
  },
  { accessorKey: "first_name", header: "Имя" },
  { accessorKey: "last_name", header: "Фамилия" },
  { accessorKey: "position", header: "Должность" },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="flex items-center space-x-2">
        <AttestationEmployeeFormSheet recordId={row.original.id}>
          <Button variant="outline" size="sm">
            <Edit2Icon className="h-4 w-4" />
          </Button>
        </AttestationEmployeeFormSheet>
        <DeleteAction recordId={row.original.id} />
      </div>
    ),
  },
];
```

- [ ] **Step 4: Create data-table + delete-action + page**

Create `data-table.tsx` by copying the permissions data-table; change generic to `typeof employees.$inferSelect`, query key `"attestation_employees"`, `fields` `"id,active,first_name,last_name,position,terminal_id"`, fetch `apiClient.api.attestation.employees.get({ query })`.

Create `delete-action.tsx` (identical shape to Task 11's, but `apiClient.api.attestation.employees({ id: recordId }).delete({})` and invalidate `["attestation_employees"]`).

Create `page.tsx` (identical shape to Task 11's page, title "Сотрудники", `AttestationEmployeeFormSheet`, `attestationEmployeeColumns`).

- [ ] **Step 5: Verify**

Visit `/<locale>/attestation/employees`. Create an employee with a terminal + PIN → appears. Edit without touching PIN → PIN unchanged (re-open shows empty PIN field, values otherwise persist). `bun lint` clean. Confirm in the network tab that responses never include `pin_hash`.

- [ ] **Step 6: Commit**

```bash
git add admin/app/[locale]/attestation/employees admin/components/forms/attestation-employee
git commit -m "feat(attestation): employees roster UI"
```

---

## Task 14: Kiosk take-test flow

**Files:**
- Create: `admin/app/[locale]/attestation/kiosk/page.tsx`

**Interfaces:**
- Consumes: `apiClient.api.attestation.tests.get` (active tests), `apiClient.api.attestation.employees.get` (roster), `apiClient.api.attestation.attempts.start.post`, `apiClient.api.attestation.attempts({id}).submit.post`.
- Produces: a fullscreen wizard — select test → select employee → PIN entry → questions → server-graded result.

- [ ] **Step 1: Build the kiosk page**

Create `admin/app/[locale]/attestation/kiosk/page.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { useState, useEffect } from "react";
import { toast } from "sonner";

type Stage = "pick_test" | "pick_employee" | "pin" | "quiz" | "result";
type Question = { id: string; text: string; type: "single" | "multi"; options: { id: string; text: string }[] };

export default function KioskPage() {
  const [stage, setStage] = useState<Stage>("pick_test");
  const [testId, setTestId] = useState<string>();
  const [employeeId, setEmployeeId] = useState<string>();
  const [terminalId, setTerminalId] = useState<string>();
  const [pin, setPin] = useState("");
  const [attemptId, setAttemptId] = useState<string>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<{ score: number; passed: boolean; expired: boolean }>();

  const { data: tests } = useQuery({
    queryKey: ["kiosk_tests"],
    queryFn: () =>
      apiClient.api.attestation.tests.get({
        query: { limit: "100", offset: "0", fields: "id,title,active" },
      }),
  });
  const { data: employees } = useQuery({
    queryKey: ["kiosk_employees"],
    queryFn: () =>
      apiClient.api.attestation.employees.get({
        query: { limit: "500", offset: "0" },
      }),
  });

  // countdown (display only; server is authoritative)
  useEffect(() => {
    if (deadline == null) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submit();
    }, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  const start = async () => {
    const res: any = await apiClient.api.attestation.attempts.start.post({
      data: { test_id: testId!, employee_id: employeeId!, terminal_id: terminalId!, pin },
    });
    if (res.error) {
      toast.error(res.error.value?.message ?? "Ошибка старта");
      return;
    }
    const d = res.data;
    setAttemptId(d.attempt_id);
    setQuestions(d.questions);
    if (d.time_limit_minutes)
      setDeadline(new Date(d.started_at).getTime() + d.time_limit_minutes * 60_000);
    setStage("quiz");
  };

  const submit = async () => {
    if (!attemptId) return;
    const payload = {
      answers: questions.map((q) => ({
        question_id: q.id,
        selected_option_ids: answers[q.id] ?? [],
      })),
    };
    const res: any = await apiClient.api.attestation
      .attempts({ id: attemptId })
      .submit.post({ data: payload });
    if (res.error) {
      toast.error(res.error.value?.message ?? "Ошибка отправки");
      return;
    }
    setResult(res.data);
    setDeadline(null);
    setStage("result");
  };

  const toggle = (q: Question, optionId: string) => {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? [];
      if (q.type === "single") return { ...prev, [q.id]: [optionId] };
      return {
        ...prev,
        [q.id]: cur.includes(optionId)
          ? cur.filter((x) => x !== optionId)
          : [...cur, optionId],
      };
    });
  };

  const reset = () => {
    setStage("pick_test");
    setTestId(undefined);
    setEmployeeId(undefined);
    setTerminalId(undefined);
    setPin("");
    setAttemptId(undefined);
    setQuestions([]);
    setAnswers({});
    setResult(undefined);
  };

  const activeTests = ((tests as any)?.data ?? []).filter((t: any) => t.active);
  const roster = (employees as any)?.data ?? [];

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-8 overflow-auto">
      <div className="w-full max-w-2xl space-y-6">
        {stage === "pick_test" && (
          <>
            <h1 className="text-2xl font-bold">Выберите тест</h1>
            <div className="grid gap-2">
              {activeTests.map((t: any) => (
                <Button
                  key={t.id}
                  variant="outline"
                  onClick={() => {
                    setTestId(t.id);
                    setStage("pick_employee");
                  }}
                >
                  {t.title}
                </Button>
              ))}
            </div>
          </>
        )}

        {stage === "pick_employee" && (
          <>
            <h1 className="text-2xl font-bold">Выберите себя</h1>
            <div className="grid gap-2 max-h-[60vh] overflow-auto">
              {roster.map((e: any) => (
                <Button
                  key={e.id}
                  variant="outline"
                  onClick={() => {
                    setEmployeeId(e.id);
                    setTerminalId(e.terminal_id);
                    setStage("pin");
                  }}
                >
                  {e.first_name} {e.last_name} — {e.position}
                </Button>
              ))}
            </div>
          </>
        )}

        {stage === "pin" && (
          <>
            <h1 className="text-2xl font-bold">Введите свой PIN</h1>
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-2xl tracking-widest"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>
                Отмена
              </Button>
              <Button onClick={start} disabled={!pin}>
                Начать
              </Button>
            </div>
          </>
        )}

        {stage === "quiz" && (
          <>
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold">Тест</h1>
              {remaining != null && (
                <span className="text-lg font-mono">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                </span>
              )}
            </div>
            {questions.map((q, i) => (
              <div key={q.id} className="border rounded-md p-4 space-y-2">
                <p className="font-medium">
                  {i + 1}. {q.text}
                </p>
                {q.options.map((o) => {
                  const selected = (answers[q.id] ?? []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(q, o.id)}
                      className={`block w-full text-left px-3 py-2 rounded border ${
                        selected ? "bg-primary text-primary-foreground" : ""
                      }`}
                    >
                      {o.text}
                    </button>
                  );
                })}
              </div>
            ))}
            <Button onClick={submit} className="w-full">
              Завершить
            </Button>
          </>
        )}

        {stage === "result" && result && (
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold">
              {result.passed ? "✅ Сдано" : "❌ Не сдано"}
            </h1>
            <p className="text-xl">Балл: {result.score}%</p>
            {result.expired && <p className="text-destructive">Время истекло</p>}
            <Button onClick={reset}>Готово</Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the full flow**

Visit `/<locale>/attestation/kiosk` as an `attestation.run` user. Pick test → pick employee → enter the employee's PIN → answer → Завершить. Result shows a server-computed score. Wrong PIN → toast error, stays on PIN screen. Start the same employee+test again → "attempt already exists" toast. Let the timer hit 0 → auto-submit with `expired`.

- [ ] **Step 3: Commit**

```bash
git add admin/app/[locale]/attestation/kiosk
git commit -m "feat(attestation): kiosk take-test flow"
```

---

## Task 15: Analytics dashboard

**Files:**
- Create: `admin/app/[locale]/attestation/analytics/page.tsx`

**Interfaces:**
- Consumes: `apiClient.api.attestation.analytics.summary.get`, `apiClient.api.attestation.analytics.attempts.get`.
- Produces: summary KPI tiles + an attempts table with filters (test, passed) and a reset action per attempt (when the user holds `attestation.reset`).

- [ ] **Step 1: Build the dashboard**

Create `admin/app/[locale]/attestation/analytics/page.tsx`:

```tsx
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useState } from "react";
import CanAccess from "@admin/components/can-access";

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const [passed, setPassed] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["attestation_summary"],
    queryFn: () => apiClient.api.attestation.analytics.summary.get(),
  });

  const { data: attempts } = useQuery({
    queryKey: ["attestation_attempts", passed],
    queryFn: () =>
      apiClient.api.attestation.analytics.attempts.get({
        query: { limit: "100", offset: "0", ...(passed ? { passed } : {}) },
      }),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.attempts({ id }).reset.post({}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["attestation_attempts"] }),
  });

  const s = (summary as any)?.data ?? summary;
  const rows = (attempts as any)?.data ?? [];

  const Tile = ({ label, value }: { label: string; value: any }) => (
    <div className="border rounded-md p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Аналитика аттестации</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Tile label="Всего" value={s?.total ?? 0} />
        <Tile label="Сдали" value={s?.passed ?? 0} />
        <Tile label="Не сдали" value={s?.failed ?? 0} />
        <Tile label="Pass rate" value={`${s?.pass_rate ?? 0}%`} />
        <Tile label="Истекают (30д)" value={s?.expiring_soon ?? 0} />
      </div>

      <div className="flex gap-2">
        <select
          className="border rounded h-9 px-2"
          value={passed}
          onChange={(e) => setPassed(e.target.value)}
        >
          <option value="">Все</option>
          <option value="true">Сдали</option>
          <option value="false">Не сдали</option>
        </select>
      </div>

      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Сотрудник</th>
              <th className="p-2">Тест</th>
              <th className="p-2">Балл</th>
              <th className="p-2">Статус</th>
              <th className="p-2">Истекает</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">
                  {r.first_name} {r.last_name}
                </td>
                <td className="p-2">{r.test_title}</td>
                <td className="p-2">{r.score ?? "—"}%</td>
                <td className="p-2">
                  {r.passed ? "✅" : "❌"} {r.status}
                </td>
                <td className="p-2">
                  {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}
                </td>
                <td className="p-2">
                  <CanAccess permission="attestation.reset">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetMutation.mutate(r.id)}
                    >
                      Сбросить
                    </Button>
                  </CanAccess>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Visit `/<locale>/attestation/analytics` as an `attestation.analytics` user. Tiles show real counts after some kiosk runs. The passed filter narrows rows. As a non-HQ manager only own-terminal attempts show. With `attestation.reset`, the Сбросить button appears and resetting lets that employee retake in the kiosk.

- [ ] **Step 3: Commit**

```bash
git add admin/app/[locale]/attestation/analytics
git commit -m "feat(attestation): analytics dashboard"
```

---

## Task 16: i18n keys (optional polish)

**Files:**
- Modify: `admin/messages/{en,ru,uz-Latn,uz-Cyrl}.json`

The pages above use inline Russian strings for speed. If the team requires localized strings, extract them into an `attestation` namespace and replace literals with `useTranslations("attestation")`. This is a mechanical follow-up and does not block the feature.

- [ ] **Step 1:** Add an `"attestation": { ... }` object with keys for each label to all four locale files (same keys, translated values).
- [ ] **Step 2:** Replace inline literals in the attestation pages with `t("key")`.
- [ ] **Step 3:** `cd admin && bun lint` and click through each page to confirm no missing-key warnings.
- [ ] **Step 4: Commit**

```bash
git add admin/messages
git commit -m "feat(attestation): i18n strings for attestation UI"
```

---

## Self-Review Notes

- **Spec coverage:** 6 tables (T1) ✓; PIN+manager anti-impersonation (T5 hash, T6 verify+manager-launch) ✓; one-attempt + HQ reset (T6 block, T8 reset) ✓; server grading/timer/sanitize/snapshots (T2/T6/T7) ✓; expiry `valid_months` (T7) ✓; permission slugs (T9) ✓; layout gate (T10) ✓; tests mgmt (T11/T12) ✓; employees roster (T13) ✓; kiosk (T14) ✓; analytics terminal-scoped (T8/T15) ✓.
- **Security invariants:** `is_correct` stripped in T6 payload and never added to the kiosk `Question` type; grading server-side in T7; timer via `started_at` in T7; `pin_hash` stripped in T5 and never selected into any client response; snapshots in T7.
- **Type consistency:** endpoint paths, `question_ids` (jsonb string[]), `answers: [{question_id, selected_option_ids}]`, and the grading signatures are used identically across T2/T6/T7/T14.
- **Known follow-ups (out of MVP scope, called out in the spec):** PIN-failure lockout counter (currently PIN just returns 401 per attempt — add a Redis counter keyed by employee if brute-force hardening is required); `valid_months` uses a 30-day month approximation; i18n extraction (T16).
