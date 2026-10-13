# Medical Examination (Медосмотр) Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Top-level «Медосмотр» section tracking recurring employee medical exams (default 6-month cycle) with overdue/due-soon flagging, per spec `docs/superpowers/specs/2026-07-16-medical-exams-design.md`.

**Architecture:** Hybrid data model — `medical_exam_schedules` (source of truth) + one materialized `medical_exams` row per cycle (exactly one open row per active schedule); future dates projected on the fly. Next due anchors to actual completion date; overdue compares today vs planned date. Backend follows the attestation module pattern (Elysia plugin + `ctx` macros + explicit-HQ scoping). Frontend is a new `admin/app/[locale]/medical/` section: KPI tiles-as-filters → TanStack table → detail Sheet → dialogs.

**Tech Stack:** Elysia/Bun, Drizzle (PostgreSQL), Eden treaty, Next.js 15, TanStack Query/Table, shadcn/ui, next-intl.

## Global Constraints

- Statuses: `unfit` | `overdue` | `due_soon` | `ok` | `none`; `DUE_SOON_DAYS = 30` (named constant).
- `status=overdue` filter must also include `unfit` rows (red tile = same set).
- Anchoring: next `planned_due_date = completed_date + interval_months` (month-end clamped). Overdue = open `planned_due_date < today`.
- Permissions: `medical_layout`, `medical.list`, `medical.edit`. HQ = super user or `attestation.hq` (reuse existing `resolveIsHq` logic). Non-HQ scope = `inArray(employees.terminal_id, terminals)`.
- Marking complete / editing schedules = `medical.edit` only. Managers are read-only.
- Dates are `YYYY-MM-DD` strings (Postgres `date` columns, Drizzle `mode` default string).
- Migrations are NOT idempotent — review generated SQL before applying; if the diff contains anything beyond the medical tables/enum, STOP and ask.
- All UI strings via next-intl `medical.*` namespace in all 4 locales (en, ru, uz-Latn, uz-Cyrl).
- Eden gotchas: `.get()` wraps body → list arrays at `res.data.data`; route segments become `apiClient.api.medical.exams({ id }).complete.post(...)`.
- Deploy to prod ONLY on explicit user authorization (separate task).

---

### Task 1: Schema + migration

**Files:**
- Modify: `backend/drizzle/schema.ts` (append after `attestation_*` tables, ~line 1590+)
- Generated: `backend/drizzle/migrations/00XX_*.sql`

**Interfaces:**
- Produces tables `medical_exam_schedules`, `medical_exams`, enum `medical_exam_result` used by Tasks 3–4.

- [ ] **Step 1: Check imports.** In `backend/drizzle/schema.ts` ensure `date` is imported from `drizzle-orm/pg-core` (the file already imports `pgTable, uuid, varchar, text, boolean, integer, timestamp, pgEnum`; add `date` to that import list if absent).

- [ ] **Step 2: Append schema objects** (match the file's existing style — plain uuid columns, no `.references()`, timestamptz string timestamps):

```ts
export const medical_exam_result = pgEnum("medical_exam_result", [
  "fit",
  "fit_restricted",
  "unfit",
]);

export const medical_exam_schedules = pgTable("medical_exam_schedules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  employee_id: uuid("employee_id").notNull().unique(),
  start_date: date("start_date").notNull(),
  interval_months: integer("interval_months").default(6).notNull(),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const medical_exams = pgTable("medical_exams", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  schedule_id: uuid("schedule_id").notNull(),
  employee_id: uuid("employee_id").notNull(),
  planned_due_date: date("planned_due_date").notNull(),
  completed_date: date("completed_date"),
  result: medical_exam_result("result"),
  notes: text("notes"),
  recorded_by: uuid("recorded_by"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});
```

- [ ] **Step 3: Generate migration.** From `backend/`: `bunx drizzle-kit generate`. Open the new SQL file. It must contain ONLY: `CREATE TYPE medical_exam_result`, `CREATE TABLE medical_exam_schedules` (with unique on employee_id), `CREATE TABLE medical_exams`. Any other statement (drops, unrelated alters) = drift → STOP, ask the user.

- [ ] **Step 4: Apply locally.** `bunx drizzle-kit migrate`. Verify: `psql "$DATABASE_URL" -c '\d medical_exams'` shows the columns.

- [ ] **Step 5: Commit.**

```bash
git add backend/drizzle/schema.ts backend/drizzle/migrations
git commit -m "feat(medical): schema for medical exam schedules and exams"
```

---

### Task 2: Pure status/date logic (TDD)

**Files:**
- Create: `backend/src/modules/medical/status.ts`
- Test: `backend/src/modules/medical/status.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3, 4):
  - `type MedicalStatus = "unfit" | "overdue" | "due_soon" | "ok" | "none"`
  - `DUE_SOON_DAYS: number` (= 30)
  - `STATUS_RANK: Record<MedicalStatus, number>` (unfit 0 … none 4)
  - `addMonthsClamped(dateIso: string, months: number): string`
  - `daysUntil(dateIso: string, todayIso: string): number` (negative = past)
  - `computeStatus(args: { lastResult: string | null; openDueDate: string | null; todayIso: string }): MedicalStatus`
  - `projectFutureDates(fromIso: string, intervalMonths: number, years?: number): string[]` (excludes `fromIso`, default 5 years)

- [ ] **Step 1: Write failing tests** at `backend/src/modules/medical/status.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  addMonthsClamped,
  computeStatus,
  daysUntil,
  projectFutureDates,
  DUE_SOON_DAYS,
} from "./status";

describe("addMonthsClamped", () => {
  it("adds months normally", () => {
    expect(addMonthsClamped("2026-07-16", 6)).toBe("2027-01-16");
  });
  it("clamps to end of shorter month", () => {
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("handles leap february", () => {
    expect(addMonthsClamped("2027-08-31", 6)).toBe("2028-02-29");
  });
  it("crosses year boundary", () => {
    expect(addMonthsClamped("2026-12-15", 2)).toBe("2027-02-15");
  });
});

describe("daysUntil", () => {
  it("positive for future, negative for past, zero today", () => {
    expect(daysUntil("2026-07-20", "2026-07-16")).toBe(4);
    expect(daysUntil("2026-07-10", "2026-07-16")).toBe(-6);
    expect(daysUntil("2026-07-16", "2026-07-16")).toBe(0);
  });
});

describe("computeStatus", () => {
  const today = "2026-07-16";
  it("unfit wins regardless of dates", () => {
    expect(
      computeStatus({ lastResult: "unfit", openDueDate: "2027-01-01", todayIso: today })
    ).toBe("unfit");
  });
  it("none when no open due date", () => {
    expect(computeStatus({ lastResult: null, openDueDate: null, todayIso: today })).toBe("none");
  });
  it("overdue when due before today", () => {
    expect(
      computeStatus({ lastResult: "fit", openDueDate: "2026-07-15", todayIso: today })
    ).toBe("overdue");
  });
  it("due_soon on boundary days 0 and DUE_SOON_DAYS", () => {
    expect(
      computeStatus({ lastResult: null, openDueDate: today, todayIso: today })
    ).toBe("due_soon");
    expect(
      computeStatus({ lastResult: null, openDueDate: "2026-08-15", todayIso: today })
    ).toBe("due_soon"); // exactly 30 days
  });
  it("ok beyond the window", () => {
    expect(
      computeStatus({ lastResult: null, openDueDate: "2026-08-16", todayIso: today })
    ).toBe("ok"); // 31 days
  });
});

describe("projectFutureDates", () => {
  it("6-month interval over 5 years yields 10 dates, excludes start", () => {
    const dates = projectFutureDates("2026-07-16", 6);
    expect(dates.length).toBe(10);
    expect(dates[0]).toBe("2027-01-16");
    expect(dates[9]).toBe("2031-07-16");
  });
  it("12-month interval over 5 years yields 5 dates", () => {
    expect(projectFutureDates("2026-01-01", 12).length).toBe(5);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `cd backend && bun test src/modules/medical/status.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `backend/src/modules/medical/status.ts`:

```ts
export type MedicalStatus = "unfit" | "overdue" | "due_soon" | "ok" | "none";

export const DUE_SOON_DAYS = 30;

export const STATUS_RANK: Record<MedicalStatus, number> = {
  unfit: 0,
  overdue: 1,
  due_soon: 2,
  ok: 3,
  none: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// "2026-08-31" + 6 -> "2027-02-28": day-of-month clamps to the target month's end.
export function addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12; // 0-based month
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const td = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((Date.parse(dateIso) - Date.parse(todayIso)) / DAY_MS);
}

export function computeStatus(args: {
  lastResult: string | null;
  openDueDate: string | null;
  todayIso: string;
}): MedicalStatus {
  if (args.lastResult === "unfit") return "unfit";
  if (!args.openDueDate) return "none";
  const days = daysUntil(args.openDueDate, args.todayIso);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "ok";
}

export function projectFutureDates(
  fromIso: string,
  intervalMonths: number,
  years = 5
): string[] {
  const out: string[] = [];
  const count = Math.floor((years * 12) / intervalMonths);
  for (let i = 1; i <= count; i++) out.push(addMonthsClamped(fromIso, intervalMonths * i));
  return out;
}
```

- [ ] **Step 4: Run tests.** `bun test src/modules/medical/status.test.ts` → all PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/modules/medical/status.ts backend/src/modules/medical/status.test.ts
git commit -m "feat(medical): pure status/date logic with tests"
```

---

### Task 3: Extract shared `resolveIsHq`

**Files:**
- Create: `backend/src/lib/resolve-is-hq.ts`
- Modify: `backend/src/modules/attestation/controller.ts:48-61` (remove local definition, import instead)

**Interfaces:**
- Produces `resolveIsHq(args: { user; role; cacheController }): Promise<boolean>` — consumed by Task 4 and by the attestation controller.

- [ ] **Step 1: Create** `backend/src/lib/resolve-is-hq.ts` with the exact function currently defined at `backend/src/modules/attestation/controller.ts:50-61` (including its comment), prefixed with `export`:

```ts
// Explicit HQ marker — super-user, or the caller's role holds attestation.hq.
// Never inferred from empty terminal scope (that would be fail-open).
export async function resolveIsHq(args: {
  user: { is_super_user?: boolean | null } | null;
  role: { id: string } | null;
  cacheController: {
    getPermissionsByRoleId: (roleId: string) => Promise<string[]>;
  };
}): Promise<boolean> {
  if (args.user?.is_super_user === true) return true;
  if (!args.role) return false;
  const perms = await args.cacheController.getPermissionsByRoleId(args.role.id);
  return perms.includes("attestation.hq");
}
```

- [ ] **Step 2: Update attestation controller.** Delete the local `resolveIsHq` (lines 48–61) and add `import { resolveIsHq } from "@backend/lib/resolve-is-hq";` to the imports.

- [ ] **Step 3: Typecheck.** `cd backend && bunx tsc --noEmit` → 0 errors (pre-existing errors, if any, must be unchanged — compare with `git stash; bunx tsc --noEmit; git stash pop` if unsure).

- [ ] **Step 4: Commit.**

```bash
git add backend/src/lib/resolve-is-hq.ts backend/src/modules/attestation/controller.ts
git commit -m "refactor(attestation): extract resolveIsHq to shared lib"
```

---

### Task 4: Medical controller + registration + permission seed

**Files:**
- Create: `backend/src/modules/medical/controller.ts`
- Create: `backend/src/modules/medical/seed-permissions.ts`
- Modify: `backend/src/controllers.ts` (import + `.use(medicalController)` next to line 44/98 where `attestationController` is wired)

**Interfaces:**
- Consumes: Task 1 tables, Task 2 functions, Task 3 `resolveIsHq`.
- Produces routes (Eden paths for Tasks 7–9):
  - `GET /medical/exams` → `{ total, data: MedicalRow[] }` where `MedicalRow = { employee_id, first_name, last_name, position, terminal_id, interval_months, last_completed_date, last_result, open_exam_id, next_due_date, days_until_due, status }`
  - `GET /medical/summary` → `{ unfit, overdue, due_soon, ok, none }`
  - `GET /medical/employees/:id` → `{ employee, schedule, open_exam, history, projections }`
  - `POST /medical/schedules` body `{ employee_id, start_date, interval_months? }`
  - `POST /medical/exams/:id/complete` body `{ completed_date, result, notes? }`
  - `PUT /medical/exams/:id` body `{ planned_due_date }`

- [ ] **Step 1: Write** `backend/src/modules/medical/controller.ts`:

```ts
import { ctx } from "@backend/context";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import {
  employees,
  medical_exam_schedules,
  medical_exams,
  users,
} from "backend/drizzle/schema";
import {
  SQLWrapper,
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import Elysia, { t } from "elysia";
import {
  DUE_SOON_DAYS,
  MedicalStatus,
  STATUS_RANK,
  addMonthsClamped,
  computeStatus,
  daysUntil,
  projectFutureDates,
} from "./status";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

// One row per scoped active employee with computed medical status.
// Employee count is small (~hundreds), so filtering/sorting happens in JS
// after three bulk queries — keeps SQL simple and the status logic in one
// tested pure function.
async function buildMedicalRows(args: {
  drizzle: any;
  isHQ: boolean;
  terminals: string[];
  search?: string;
  terminal_id?: string;
}) {
  const where: (SQLWrapper | undefined)[] = [eq(employees.active, true)];
  if (!args.isHQ) where.push(inArray(employees.terminal_id, args.terminals));
  if (args.search)
    where.push(
      or(
        ilike(employees.first_name, `%${args.search}%`),
        ilike(employees.last_name, `%${args.search}%`)
      )
    );
  if (args.terminal_id) where.push(eq(employees.terminal_id, args.terminal_id));
  const emps = await args.drizzle
    .select({
      id: employees.id,
      first_name: employees.first_name,
      last_name: employees.last_name,
      position: employees.position,
      terminal_id: employees.terminal_id,
    })
    .from(employees)
    .where(and(...where))
    .execute();
  const ids = emps.map((e: any) => e.id);
  const [schedules, openRows, doneRows] = ids.length
    ? await Promise.all([
        args.drizzle
          .select()
          .from(medical_exam_schedules)
          .where(
            and(
              inArray(medical_exam_schedules.employee_id, ids),
              eq(medical_exam_schedules.active, true)
            )
          )
          .execute(),
        args.drizzle
          .select()
          .from(medical_exams)
          .where(
            and(
              inArray(medical_exams.employee_id, ids),
              isNull(medical_exams.completed_date)
            )
          )
          .execute(),
        args.drizzle
          .select()
          .from(medical_exams)
          .where(
            and(
              inArray(medical_exams.employee_id, ids),
              isNotNull(medical_exams.completed_date)
            )
          )
          .orderBy(desc(medical_exams.completed_date))
          .execute(),
      ])
    : [[], [], []];
  const scheduleByEmp = new Map(schedules.map((s: any) => [s.employee_id, s]));
  const openByEmp = new Map(openRows.map((x: any) => [x.employee_id, x]));
  const lastByEmp = new Map<string, any>();
  for (const x of doneRows as any[])
    if (!lastByEmp.has(x.employee_id)) lastByEmp.set(x.employee_id, x);
  const today = todayIso();
  return emps.map((e: any) => {
    const sched = scheduleByEmp.get(e.id) as any;
    const open = sched ? (openByEmp.get(e.id) as any) : null;
    const last = lastByEmp.get(e.id) as any;
    const status = computeStatus({
      lastResult: last?.result ?? null,
      openDueDate: open?.planned_due_date ?? null,
      todayIso: today,
    });
    return {
      employee_id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      position: e.position,
      terminal_id: e.terminal_id,
      interval_months: sched?.interval_months ?? null,
      last_completed_date: last?.completed_date ?? null,
      last_result: last?.result ?? null,
      open_exam_id: open?.id ?? null,
      next_due_date: open?.planned_due_date ?? null,
      days_until_due: open ? daysUntil(open.planned_due_date, today) : null,
      status,
    };
  });
}

// Loads an exam row and enforces terminal scope via its employee.
async function loadScopedExam(args: {
  drizzle: any;
  id: string;
  isHQ: boolean;
  terminals: string[];
}) {
  const rows = await args.drizzle
    .select()
    .from(medical_exams)
    .where(eq(medical_exams.id, args.id))
    .execute();
  if (!rows.length) return { error: 404 as const };
  const exam = rows[0];
  const emp = await args.drizzle
    .select({ terminal_id: employees.terminal_id })
    .from(employees)
    .where(eq(employees.id, exam.employee_id))
    .execute();
  if (
    !args.isHQ &&
    (!emp.length || !args.terminals.includes(emp[0].terminal_id))
  )
    return { error: 403 as const };
  return { exam };
}

export const medicalController = new Elysia({ name: "@api/medical" })
  .use(ctx)
  .get(
    "/medical/exams",
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      let rows = await buildMedicalRows({
        drizzle,
        isHQ,
        terminals,
        search: query.search,
        terminal_id: query.terminal_id,
      });
      if (query.status) {
        const wanted: MedicalStatus[] =
          query.status === "overdue"
            ? ["overdue", "unfit"]
            : [query.status as MedicalStatus];
        rows = rows.filter((r: any) => wanted.includes(r.status));
      }
      rows.sort(
        (a: any, b: any) =>
          STATUS_RANK[a.status as MedicalStatus] -
            STATUS_RANK[b.status as MedicalStatus] ||
          String(a.next_due_date ?? "9999-12-31").localeCompare(
            String(b.next_due_date ?? "9999-12-31")
          ) ||
          a.last_name.localeCompare(b.last_name, "ru")
      );
      const offset = +(query.offset ?? "0");
      const limit = +(query.limit ?? "50");
      return { total: rows.length, data: rows.slice(offset, offset + limit) };
    },
    {
      permission: "medical.list",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        search: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/medical/summary",
    async ({ user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const rows = await buildMedicalRows({ drizzle, isHQ, terminals });
      const counts = { unfit: 0, overdue: 0, due_soon: 0, ok: 0, none: 0 };
      for (const r of rows) counts[r.status as MedicalStatus]++;
      return counts;
    },
    { permission: "medical.list" }
  )
  .get(
    "/medical/employees/:id",
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const empRows = await drizzle
        .select({
          id: employees.id,
          first_name: employees.first_name,
          last_name: employees.last_name,
          position: employees.position,
          terminal_id: employees.terminal_id,
        })
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!empRows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = empRows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const schedules = await drizzle
        .select()
        .from(medical_exam_schedules)
        .where(eq(medical_exam_schedules.employee_id, id))
        .execute();
      const schedule = schedules[0] ?? null;
      const history = await drizzle
        .select({
          id: medical_exams.id,
          planned_due_date: medical_exams.planned_due_date,
          completed_date: medical_exams.completed_date,
          result: medical_exams.result,
          notes: medical_exams.notes,
          recorded_by_name: users.first_name,
          recorded_by_last_name: users.last_name,
        })
        .from(medical_exams)
        .leftJoin(users, eq(users.id, medical_exams.recorded_by))
        .where(
          and(eq(medical_exams.employee_id, id), isNotNull(medical_exams.completed_date))
        )
        .orderBy(desc(medical_exams.completed_date))
        .execute();
      const openRows = await drizzle
        .select()
        .from(medical_exams)
        .where(
          and(eq(medical_exams.employee_id, id), isNull(medical_exams.completed_date))
        )
        .execute();
      const open_exam = openRows[0] ?? null;
      const projections =
        schedule?.active && open_exam
          ? projectFutureDates(open_exam.planned_due_date, schedule.interval_months)
          : [];
      return { employee: emp, schedule, open_exam, history, projections };
    },
    { permission: "medical.list", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/medical/schedules",
    async ({ body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.start_date)) {
        set.status = 422;
        return { message: "start_date must be YYYY-MM-DD" };
      }
      const interval = body.interval_months ?? 6;
      if (interval < 1 || interval > 60) {
        set.status = 422;
        return { message: "interval_months out of range" };
      }
      const empRows = await drizzle
        .select({ id: employees.id, terminal_id: employees.terminal_id })
        .from(employees)
        .where(eq(employees.id, body.employee_id))
        .execute();
      if (!empRows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(empRows[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      return await drizzle.transaction(async (tx: any) => {
        const existing = await tx
          .select()
          .from(medical_exam_schedules)
          .where(eq(medical_exam_schedules.employee_id, body.employee_id))
          .execute();
        if (!existing.length) {
          const inserted = await tx
            .insert(medical_exam_schedules)
            .values({
              employee_id: body.employee_id,
              start_date: body.start_date,
              interval_months: interval,
            })
            .returning()
            .execute();
          await tx
            .insert(medical_exams)
            .values({
              schedule_id: inserted[0].id,
              employee_id: body.employee_id,
              planned_due_date: body.start_date,
            })
            .execute();
          return { data: inserted[0] };
        }
        const schedule = existing[0];
        const updated = await tx
          .update(medical_exam_schedules)
          .set({
            start_date: body.start_date,
            interval_months: interval,
            active: true,
            updated_at: new Date().toISOString(),
          })
          .where(eq(medical_exam_schedules.id, schedule.id))
          .returning()
          .execute();
        const done = await tx
          .select({ completed_date: medical_exams.completed_date })
          .from(medical_exams)
          .where(
            and(
              eq(medical_exams.schedule_id, schedule.id),
              isNotNull(medical_exams.completed_date)
            )
          )
          .orderBy(desc(medical_exams.completed_date))
          .execute();
        const open = await tx
          .select()
          .from(medical_exams)
          .where(
            and(
              eq(medical_exams.schedule_id, schedule.id),
              isNull(medical_exams.completed_date)
            )
          )
          .execute();
        if (open.length && !done.length) {
          // No completions yet — the open row simply follows the new start date.
          await tx
            .update(medical_exams)
            .set({
              planned_due_date: body.start_date,
              updated_at: new Date().toISOString(),
            })
            .where(eq(medical_exams.id, open[0].id))
            .execute();
        } else if (!open.length) {
          // Schedule was reactivated: open the next cycle from the last completion.
          const from = done.length ? done[0].completed_date : body.start_date;
          await tx
            .insert(medical_exams)
            .values({
              schedule_id: schedule.id,
              employee_id: body.employee_id,
              planned_due_date: done.length
                ? addMonthsClamped(from, interval)
                : body.start_date,
            })
            .execute();
        }
        return { data: updated[0] };
      });
    },
    {
      permission: "medical.edit",
      body: t.Object({
        employee_id: t.String(),
        start_date: t.String(),
        interval_months: t.Optional(t.Number()),
      }),
    }
  )
  .post(
    "/medical/exams/:id/complete",
    async ({ params: { id }, body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.completed_date)) {
        set.status = 422;
        return { message: "completed_date must be YYYY-MM-DD" };
      }
      if (body.completed_date > todayIso()) {
        set.status = 422;
        return { message: "completed_date cannot be in the future" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const loaded = await loadScopedExam({ drizzle, id, isHQ, terminals });
      if (loaded.error === 404) {
        set.status = 404;
        return { message: "Exam not found" };
      }
      if (loaded.error === 403) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const exam = loaded.exam!;
      if (exam.completed_date) {
        set.status = 409;
        return { message: "Exam already completed" };
      }
      const scheduleRows = await drizzle
        .select()
        .from(medical_exam_schedules)
        .where(eq(medical_exam_schedules.id, exam.schedule_id))
        .execute();
      const schedule = scheduleRows[0];
      return await drizzle.transaction(async (tx: any) => {
        const updated = await tx
          .update(medical_exams)
          .set({
            completed_date: body.completed_date,
            result: body.result,
            notes: body.notes ?? null,
            recorded_by: user!.id,
            updated_at: new Date().toISOString(),
          })
          .where(eq(medical_exams.id, id))
          .returning()
          .execute();
        const next = await tx
          .insert(medical_exams)
          .values({
            schedule_id: exam.schedule_id,
            employee_id: exam.employee_id,
            planned_due_date: addMonthsClamped(
              body.completed_date,
              schedule.interval_months
            ),
          })
          .returning()
          .execute();
        return { data: updated[0], next: next[0] };
      });
    },
    {
      permission: "medical.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        completed_date: t.String(),
        result: t.Union([
          t.Literal("fit"),
          t.Literal("fit_restricted"),
          t.Literal("unfit"),
        ]),
        notes: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  .put(
    "/medical/exams/:id",
    async ({ params: { id }, body, user, role, terminals, cacheController, set, drizzle }) => {
      if (!DATE_RE.test(body.planned_due_date)) {
        set.status = 422;
        return { message: "planned_due_date must be YYYY-MM-DD" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const loaded = await loadScopedExam({ drizzle, id, isHQ, terminals });
      if (loaded.error === 404) {
        set.status = 404;
        return { message: "Exam not found" };
      }
      if (loaded.error === 403) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      if (loaded.exam!.completed_date) {
        set.status = 409;
        return { message: "Cannot reschedule a completed exam" };
      }
      const updated = await drizzle
        .update(medical_exams)
        .set({
          planned_due_date: body.planned_due_date,
          updated_at: new Date().toISOString(),
        })
        .where(eq(medical_exams.id, id))
        .returning()
        .execute();
      return { data: updated[0] };
    },
    {
      permission: "medical.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({ planned_due_date: t.String() }),
    }
  );
```

- [ ] **Step 2: Register.** In `backend/src/controllers.ts`, next to the attestation lines (import at ~44, use at ~98):

```ts
import { medicalController } from "./modules/medical/controller";
// ...
  .use(medicalController);
```

- [ ] **Step 3: Seed script.** Create `backend/src/modules/medical/seed-permissions.ts` — copy the structure of `backend/src/modules/attestation/seed-permissions.ts` (same imports, same insert-if-missing loop) with:

```ts
const SLUGS: { slug: string; description: string }[] = [
  { slug: "medical_layout", description: "Medical: top-level layout/section" },
  { slug: "medical.list", description: "Medical: view exam statuses" },
  { slug: "medical.edit", description: "Medical: manage schedules + mark exams" },
];
```

- [ ] **Step 4: Run seed + typecheck.** `cd backend && bun run src/modules/medical/seed-permissions.ts` → 3 inserted. `bunx tsc --noEmit` → clean. Grant the three slugs to the local admin role (SQL insert into `roles_permissions`, same as done for attestation slugs) so local testing works.

- [ ] **Step 5: Smoke test.** With the dev backend running and an authenticated session cookie: `GET /api/medical/summary` returns `{"unfit":0,"overdue":0,...}`; `GET /api/medical/exams?limit=5&offset=0` returns employees with `status: "none"`.

- [ ] **Step 6: Commit.**

```bash
git add backend/src/modules/medical backend/src/controllers.ts
git commit -m "feat(medical): controller, permissions seed, registration"
```

---

### Task 5: Employee create → optional first-exam schedule

**Files:**
- Modify: `backend/src/modules/attestation/controller.ts:415-443` (`POST /attestation/employees`)

**Interfaces:**
- Consumes Task 1 tables. Body gains `data.medical_start_date?: string | null` (used by Task 9 form).

- [ ] **Step 1: Extend handler.** Replace the insert block so employee + optional schedule are one transaction:

```ts
      const { medical_start_date, ...empData } = data;
      if (medical_start_date && !/^\d{4}-\d{2}-\d{2}$/.test(medical_start_date)) {
        set.status = 422;
        return { message: "medical_start_date must be YYYY-MM-DD" };
      }
      const inserted = await drizzle.transaction(async (tx) => {
        const emp = await tx
          .insert(employees)
          .values(empData)
          .returning({ id: employees.id })
          .execute();
        if (medical_start_date) {
          const sched = await tx
            .insert(medical_exam_schedules)
            .values({ employee_id: emp[0].id, start_date: medical_start_date })
            .returning({ id: medical_exam_schedules.id })
            .execute();
          await tx
            .insert(medical_exams)
            .values({
              schedule_id: sched[0].id,
              employee_id: emp[0].id,
              planned_due_date: medical_start_date,
            })
            .execute();
        }
        return emp;
      });
      return { data: inserted[0] };
```

Add `medical_exam_schedules, medical_exams` to the schema import in this file, and to the body schema add:

```ts
          medical_start_date: t.Optional(t.Nullable(t.String())),
```

- [ ] **Step 2: Typecheck.** `cd backend && bunx tsc --noEmit` → clean.

- [ ] **Step 3: Smoke test.** POST an employee with `medical_start_date: "2026-07-16"` → row appears in `medical_exam_schedules` + open `medical_exams` row. POST without the field → no schedule rows.

- [ ] **Step 4: Commit.**

```bash
git add backend/src/modules/attestation/controller.ts
git commit -m "feat(medical): optional first-exam schedule on employee create"
```

---

### Task 6: i18n `medical.*` namespace

**Files:**
- Modify: `admin/messages/ru.json`, `admin/messages/en.json`, `admin/messages/uz-Latn.json`, `admin/messages/uz-Cyrl.json`

- [ ] **Step 1: Add to `ru.json`** (top-level `"medical"` key, sibling of `"attestation"`):

```json
"medical": {
  "title": "Медосмотр",
  "nav": "Медосмотр",
  "tiles": { "overdue": "Просрочено", "dueSoon": "Скоро", "ok": "В норме", "none": "Без графика" },
  "table": { "employee": "Сотрудник", "branch": "Филиал", "position": "Должность", "lastExam": "Последний осмотр", "nextExam": "Следующий", "status": "Статус", "due": "Срок" },
  "status": { "unfit": "Не годен", "overdue": "Просрочен", "due_soon": "Скоро", "ok": "В норме", "none": "Нет графика" },
  "rel": { "inDays": "через {n} дн", "overdueDays": "просрочен {n} дн", "today": "сегодня" },
  "actions": { "complete": "Отметить", "schedule": "График" },
  "sheet": { "history": "История", "next": "Следующий", "upcoming": "Будущие даты", "noSchedule": "График не задан", "recordedBy": "Отметил" },
  "completeDialog": { "title": "Отметить медосмотр", "date": "Дата осмотра", "result": "Результат", "notes": "Комментарий", "nextInfo": "Следующий осмотр: {date}", "save": "Сохранить", "fit": "Годен", "fit_restricted": "Годен с ограничениями", "unfit": "Не годен" },
  "scheduleDialog": { "title": "График медосмотра", "startDate": "Дата первого осмотра", "interval": "Интервал (месяцев)", "save": "Сохранить" },
  "employeeForm": { "medicalStartDate": "Дата первого медосмотра" },
  "toasts": { "completed": "Медосмотр отмечен", "scheduleSaved": "График сохранён" },
  "filters": { "search": "Поиск по ФИО", "branch": "Филиал", "all": "Все", "reset": "Сброс" }
}
```

- [ ] **Step 2: Translate for the other three locales.** en: "Medical exams", "Overdue", "Due soon", "OK", "No schedule", "Unfit", "Fit", "Fit with restrictions", "in {n} d", "{n} d overdue", "today", "Mark done", "Schedule", "History", "Upcoming dates", "Recorded by", "Mark medical exam", "Exam date", "Result", "Notes", "Next exam: {date}", "Save", "Medical exam schedule", "First exam date", "Interval (months)", "First medical exam date", "Exam recorded", "Schedule saved", "Search by name", "Branch", "All", "Reset". uz-Latn: "Tibbiy ko'rik", "Muddati o'tgan", "Yaqin orada", "Me'yorda", "Jadval yo'q", "Yaroqsiz", "Yaroqli", "Cheklovlar bilan yaroqli", "{n} kundan keyin", "{n} kun kechikkan", "bugun", "Belgilash", "Jadval", "Tarix", "Kelgusi sanalar", "Kim belgiladi", "Tibbiy ko'rikni belgilash", "Ko'rik sanasi", "Natija", "Izoh", "Keyingi ko'rik: {date}", "Saqlash", "Tibbiy ko'rik jadvali", "Birinchi ko'rik sanasi", "Interval (oy)", "Birinchi tibbiy ko'rik sanasi", "Ko'rik belgilandi", "Jadval saqlandi", "F.I.Sh bo'yicha qidirish", "Filial", "Barchasi", "Tozalash". uz-Cyrl: same in Cyrillic script ("Тиббий кўрик", "Муддати ўтган", "Яқин орада", "Меъёрда", "Жадвал йўқ", "Яроқсиз", "Яроқли", "Чекловлар билан яроқли", "{n} кундан кейин", "{n} кун кечиккан", "бугун", "Белгилаш", "Жадвал", "Тарих", "Келгуси саналар", "Ким белгилади", "Тиббий кўрикни белгилаш", "Кўрик санаси", "Натижа", "Изоҳ", "Кейинги кўрик: {date}", "Сақлаш", "Тиббий кўрик жадвали", "Биринчи кўрик санаси", "Интервал (ой)", "Биринчи тиббий кўрик санаси", "Кўрик белгиланди", "Жадвал сақланди", "Ф.И.Ш бўйича қидириш", "Филиал", "Барчаси", "Тозалаш").

- [ ] **Step 3: Validate.** `for f in admin/messages/*.json; do bun -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f ok"; done`

- [ ] **Step 4: Commit.**

```bash
git add admin/messages
git commit -m "feat(medical): i18n strings for all locales"
```

---

### Task 7: Navigation + section layout

**Files:**
- Create: `admin/app/[locale]/medical/layout.tsx`
- Modify: `admin/components/layout/main-nav.tsx:222` (after the attestation `</CanAccess>`)
- Modify: `admin/components/layout/manager-layout.tsx` (bottom nav, grid `grid-cols-6` at line 15, attestation item at ~108)

- [ ] **Step 1: Section layout** `admin/app/[locale]/medical/layout.tsx` (same shape as `admin/app/[locale]/attestation/layout.tsx` but no sub-nav component — single page section):

```tsx
"use client";
import React from "react";
import CanAccess from "@admin/components/can-access";

export default function MedicalSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CanAccess permission="medical_layout">{children}</CanAccess>;
}
```

- [ ] **Step 2: Top nav.** In `admin/components/layout/main-nav.tsx`, directly after the attestation `</CanAccess>` (line 222), add:

```tsx
        <CanAccess permission="medical_layout">
          <NavigationMenuItem>
            <Link href={`/${locale}/medical`} legacyBehavior passHref>
              <NavigationMenuLink className={navigationMenuTriggerStyle()}>
                Медосмотр
              </NavigationMenuLink>
            </Link>
          </NavigationMenuItem>
        </CanAccess>
```

- [ ] **Step 3: Manager tablet nav.** In `admin/components/layout/manager-layout.tsx`: change `grid-cols-6` to `grid-cols-7` (line 15). Duplicate the attestation `<CanAccess permission="attestation.run">` nav-item block (~line 108), changing: permission → `medical.list`, href → `` `/${locale}/medical` ``, label → `Медосмотр`, icon → `Stethoscope` from `lucide-react` (add to the existing lucide import).

- [ ] **Step 4: Typecheck + commit.** `cd admin && bunx tsc --noEmit` → clean (baseline-equal).

```bash
git add "admin/app/[locale]/medical/layout.tsx" admin/components/layout/main-nav.tsx admin/components/layout/manager-layout.tsx
git commit -m "feat(medical): navigation entries and section layout"
```

Note: roles that should see the section need `medical_layout` + `medical.list` (+ `medical.edit` for office) granted via `roles_permissions` — done at deploy time, listed in Task 11.

---

### Task 8: List page — tiles, toolbar, table

**Files:**
- Create: `admin/app/[locale]/medical/status-badge.tsx`
- Create: `admin/app/[locale]/medical/page.tsx`

**Interfaces:**
- Consumes: `GET /medical/exams`, `GET /medical/summary` (Task 4 row shape), `medical.*` i18n (Task 6).
- Produces: `<StatusBadge status={...} />` and page-level state `sheetEmployeeId` handed to Task 9's `EmployeeSheet`.

- [ ] **Step 1: Status badge** `admin/app/[locale]/medical/status-badge.tsx`:

```tsx
"use client";
import { useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";

const STYLES: Record<string, string> = {
  unfit: "bg-red-100 text-red-700 border-red-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  due_soon: "bg-amber-100 text-amber-700 border-amber-200",
  ok: "bg-green-100 text-green-700 border-green-200",
  none: "bg-gray-100 text-gray-600 border-gray-200",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("medical.status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STYLES[status] ?? STYLES.none
      )}
    >
      {t(status as any)}
    </span>
  );
}
```

(If `@admin/lib/utils` `cn` does not exist, use the same `cn` import other admin components use — grep `from ".*utils"` in `admin/components/ui/badge.tsx` and copy it.)

- [ ] **Step 2: Page** `admin/app/[locale]/medical/page.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { StatusBadge } from "./status-badge";
import { EmployeeSheet } from "./employee-sheet";
import { CompleteDialog } from "./complete-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { cn } from "@admin/lib/utils";

const PAGE_SIZE = 20;

// KPI tile: red tile maps to status=overdue which the backend expands to
// overdue+unfit, so the count shown must be the same union.
const TILES = [
  { key: "overdue", styles: "border-red-300 text-red-700", active: "bg-red-50" },
  { key: "due_soon", styles: "border-amber-300 text-amber-700", active: "bg-amber-50" },
  { key: "ok", styles: "border-green-300 text-green-700", active: "bg-green-50" },
  { key: "none", styles: "border-gray-300 text-gray-600", active: "bg-gray-50" },
] as const;

export default function MedicalPage() {
  const t = useTranslations("medical");
  const [status, setStatus] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [search, setSearch] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sheetEmployeeId, setSheetEmployeeId] = useState<string | null>(null);
  const [completeExam, setCompleteExam] = useState<{
    examId: string;
    intervalMonths: number;
  } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{
    employeeId: string;
    startDate?: string | null;
    intervalMonths?: number | null;
  } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    setPage(0);
  }, [debSearch, terminalId, status]);

  const { data: summaryRes } = useQuery({
    queryKey: ["medical_summary"],
    queryFn: () => apiClient.api.medical.summary.get(),
  });
  const summary = ((summaryRes as any)?.data ?? {}) as Record<string, number>;
  const tileCount = (key: string) =>
    key === "overdue"
      ? (summary.overdue ?? 0) + (summary.unfit ?? 0)
      : summary[key] ?? 0;

  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: () => apiClient.api.terminals.cached.get(),
  });
  const terminalList = [
    ...((terminalsData as any)?.data ?? terminalsData ?? []),
  ].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "ru"));
  const terminalName = useMemo(() => {
    const m = new Map(terminalList.map((x: any) => [x.id, x.name]));
    return (id: string) => m.get(id) ?? "—";
  }, [terminalList]);

  const { data: listRes, isLoading } = useQuery({
    queryKey: ["medical_exams", status, terminalId, debSearch, page],
    queryFn: () =>
      apiClient.api.medical.exams.get({
        query: {
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
          ...(status ? { status } : {}),
          ...(terminalId ? { terminal_id: terminalId } : {}),
          ...(debSearch ? { search: debSearch } : {}),
        },
      }),
  });
  const rows = ((listRes as any)?.data?.data ?? []) as any[];
  const total = Number((listRes as any)?.data?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const relDue = (r: any) => {
    if (r.days_until_due == null) return "—";
    if (r.days_until_due < 0)
      return t("rel.overdueDays", { n: -r.days_until_due });
    if (r.days_until_due === 0) return t("rel.today");
    return t("rel.inDays", { n: r.days_until_due });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">{t("title")}</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {TILES.map((tile) => (
          <button
            key={tile.key}
            onClick={() => setStatus(status === tile.key ? "" : tile.key)}
            className={cn(
              "border rounded-md p-4 text-left transition-colors",
              tile.styles,
              status === tile.key && tile.active,
              status === tile.key && "ring-2 ring-offset-1 ring-current"
            )}
          >
            <div className="text-sm">{t(`tiles.${tile.key === "due_soon" ? "dueSoon" : tile.key}` as any)}</div>
            <div className="text-2xl font-bold">{tileCount(tile.key)}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("filters.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[200px]"
        />
        <Select
          value={terminalId || "__all__"}
          onValueChange={(v) => setTerminalId(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue placeholder={t("filters.branch")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("filters.all")}</SelectItem>
            {terminalList.map((term: any) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setStatus("");
            setTerminalId("");
            setSearch("");
          }}
        >
          {t("filters.reset")}
        </Button>
      </div>

      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.employee")}</TableHead>
              <TableHead>{t("table.branch")}</TableHead>
              <TableHead>{t("table.position")}</TableHead>
              <TableHead>{t("table.lastExam")}</TableHead>
              <TableHead>{t("table.nextExam")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>{t("table.due")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : rows.length ? (
              rows.map((r) => (
                <TableRow
                  key={r.employee_id}
                  className={cn(
                    "cursor-pointer",
                    (r.status === "overdue" || r.status === "unfit") &&
                      "border-l-2 border-l-red-500"
                  )}
                  onClick={() => setSheetEmployeeId(r.employee_id)}
                >
                  <TableCell className="font-medium">
                    {r.first_name} {r.last_name}
                  </TableCell>
                  <TableCell>{terminalName(r.terminal_id)}</TableCell>
                  <TableCell>{r.position ?? "—"}</TableCell>
                  <TableCell>
                    {r.last_completed_date
                      ? new Date(r.last_completed_date).toLocaleDateString("ru")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {r.next_due_date
                      ? new Date(r.next_due_date).toLocaleDateString("ru")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {relDue(r)}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <CanAccess permission="medical.edit">
                      <div className="flex gap-2">
                        {r.open_exam_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setCompleteExam({
                                examId: r.open_exam_id,
                                intervalMonths: r.interval_months ?? 6,
                              })
                            }
                          >
                            {t("actions.complete")}
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setScheduleFor({
                              employeeId: r.employee_id,
                              intervalMonths: r.interval_months,
                            })
                          }
                        >
                          {t("actions.schedule")}
                        </Button>
                      </div>
                    </CanAccess>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-sm">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          ←
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </Button>
      </div>

      <EmployeeSheet
        employeeId={sheetEmployeeId}
        onClose={() => setSheetEmployeeId(null)}
        onComplete={(examId, intervalMonths) =>
          setCompleteExam({ examId, intervalMonths })
        }
        onSchedule={(employeeId, startDate, intervalMonths) =>
          setScheduleFor({ employeeId, startDate, intervalMonths })
        }
      />
      <CompleteDialog
        exam={completeExam}
        onClose={() => setCompleteExam(null)}
      />
      <ScheduleDialog
        target={scheduleFor}
        onClose={() => setScheduleFor(null)}
      />
    </div>
  );
}
```

- [ ] **Step 3:** Task 9 creates the three imported components — typecheck happens there. Commit page + badge now:

```bash
git add "admin/app/[locale]/medical/status-badge.tsx" "admin/app/[locale]/medical/page.tsx"
git commit -m "feat(medical): list page with KPI tile filters and status table"
```

---

### Task 9: Sheet + dialogs + employee form field

**Files:**
- Create: `admin/app/[locale]/medical/employee-sheet.tsx`
- Create: `admin/app/[locale]/medical/complete-dialog.tsx`
- Create: `admin/app/[locale]/medical/schedule-dialog.tsx`
- Modify: `admin/components/forms/attestation-employee/_form.tsx` (add optional first-exam date on create)

**Interfaces:**
- Consumes: `GET /medical/employees/:id`, `POST /medical/exams/:id/complete`, `POST /medical/schedules` (Task 4); props defined in Task 8's page.

- [ ] **Step 1: Employee sheet** `admin/app/[locale]/medical/employee-sheet.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@components/ui/sheet";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { StatusBadge } from "./status-badge";

export function EmployeeSheet({
  employeeId,
  onClose,
  onComplete,
  onSchedule,
}: {
  employeeId: string | null;
  onClose: () => void;
  onComplete: (examId: string, intervalMonths: number) => void;
  onSchedule: (
    employeeId: string,
    startDate?: string | null,
    intervalMonths?: number | null
  ) => void;
}) {
  const t = useTranslations("medical");
  const { data: res } = useQuery({
    queryKey: ["medical_employee", employeeId],
    queryFn: () =>
      apiClient.api.medical.employees({ id: employeeId! }).get({}),
    enabled: !!employeeId,
  });
  const d = ((res as any)?.data ?? null) as any;
  const fmt = (x: string) => new Date(x).toLocaleDateString("ru");

  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto p-6">
        {d?.employee && (
          <>
            <SheetHeader>
              <SheetTitle>
                {d.employee.first_name} {d.employee.last_name}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-6">
              {!d.schedule && (
                <p className="text-muted-foreground">{t("sheet.noSchedule")}</p>
              )}
              {d.projections?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {t("sheet.upcoming")}
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {d.projections.slice(0, 6).map((p: string) => (
                      <li key={p} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-gray-300" />
                        {fmt(p)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.open_exam && (
                <div className="border rounded-md p-3">
                  <div className="text-sm font-semibold">{t("sheet.next")}</div>
                  <div className="text-lg">{fmt(d.open_exam.planned_due_date)}</div>
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-2">{t("sheet.history")}</h4>
                {d.history?.length ? (
                  <ul className="space-y-3">
                    {d.history.map((h: any) => (
                      <li key={h.id} className="border-l-2 pl-3 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{fmt(h.completed_date)}</span>
                          <StatusBadge
                            status={h.result === "unfit" ? "unfit" : "ok"}
                          />
                          <span className="text-xs text-muted-foreground">
                            {t(`completeDialog.${h.result}` as any)}
                          </span>
                        </div>
                        {h.notes && (
                          <div className="text-sm text-muted-foreground">{h.notes}</div>
                        )}
                        {h.recorded_by_name && (
                          <div className="text-xs text-muted-foreground">
                            {t("sheet.recordedBy")}: {h.recorded_by_name}{" "}
                            {h.recorded_by_last_name}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <CanAccess permission="medical.edit">
                <div className="flex gap-2 pt-2">
                  {d.open_exam && (
                    <Button
                      onClick={() =>
                        onComplete(d.open_exam.id, d.schedule?.interval_months ?? 6)
                      }
                    >
                      {t("completeDialog.title")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      onSchedule(
                        d.employee.id,
                        d.schedule?.start_date,
                        d.schedule?.interval_months
                      )
                    }
                  >
                    {t("scheduleDialog.title")}
                  </Button>
                </div>
              </CanAccess>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Complete dialog** `admin/app/[locale]/medical/complete-dialog.tsx`:

```tsx
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Textarea } from "@components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

function addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(
    Math.min(d, lastDay)
  ).padStart(2, "0")}`;
}

export function CompleteDialog({
  exam,
  onClose,
}: {
  exam: { examId: string; intervalMonths: number } | null;
  onClose: () => void;
}) {
  const t = useTranslations("medical");
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [result, setResult] = useState("fit");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (exam) {
      setDate(today);
      setResult("fit");
      setNotes("");
    }
  }, [exam]);

  const nextDate = useMemo(
    () => (exam && date ? addMonthsClamped(date, exam.intervalMonths) : null),
    [exam, date]
  );

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.api.medical
        .exams({ id: exam!.examId })
        .complete.post({
          completed_date: date,
          result: result as any,
          ...(notes ? { notes } : {}),
        }),
    onSuccess: (res: any) => {
      if (res?.status && res.status >= 400) {
        toast.error(res?.error?.value?.message ?? "Error");
        return;
      }
      toast.success(t("toasts.completed"));
      qc.invalidateQueries({ queryKey: ["medical_exams"] });
      qc.invalidateQueries({ queryKey: ["medical_summary"] });
      qc.invalidateQueries({ queryKey: ["medical_employee"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!exam} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("completeDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("completeDialog.date")}</Label>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("completeDialog.result")}</Label>
            <Select value={result} onValueChange={setResult}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fit">{t("completeDialog.fit")}</SelectItem>
                <SelectItem value="fit_restricted">
                  {t("completeDialog.fit_restricted")}
                </SelectItem>
                <SelectItem value="unfit">{t("completeDialog.unfit")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("completeDialog.notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {nextDate && (
            <p className="text-sm text-muted-foreground">
              {t("completeDialog.nextInfo", {
                date: new Date(nextDate).toLocaleDateString("ru"),
              })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !date}
          >
            {t("completeDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

(If `@components/ui/textarea` does not exist, check `admin/components/ui/` — the attestation question form uses one; reuse that import path.)

- [ ] **Step 3: Schedule dialog** `admin/app/[locale]/medical/schedule-dialog.tsx`:

```tsx
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function ScheduleDialog({
  target,
  onClose,
}: {
  target: {
    employeeId: string;
    startDate?: string | null;
    intervalMonths?: number | null;
  } | null;
  onClose: () => void;
}) {
  const t = useTranslations("medical");
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const [interval, setInterval] = useState("6");

  useEffect(() => {
    if (target) {
      setStartDate(target.startDate ?? "");
      setInterval(String(target.intervalMonths ?? 6));
    }
  }, [target]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.api.medical.schedules.post({
        employee_id: target!.employeeId,
        start_date: startDate,
        interval_months: Number(interval),
      }),
    onSuccess: (res: any) => {
      if (res?.status && res.status >= 400) {
        toast.error(res?.error?.value?.message ?? "Error");
        return;
      }
      toast.success(t("toasts.scheduleSaved"));
      qc.invalidateQueries({ queryKey: ["medical_exams"] });
      qc.invalidateQueries({ queryKey: ["medical_summary"] });
      qc.invalidateQueries({ queryKey: ["medical_employee"] });
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scheduleDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t("scheduleDialog.startDate")}</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("scheduleDialog.interval")}</Label>
            <Input
              type="number"
              min={1}
              max={60}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !startDate}
          >
            {t("scheduleDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Employee form field.** In `admin/components/forms/attestation-employee/_form.tsx`:
  - Add `medical_start_date: ""` to `useForm` `defaultValues`.
  - In `onSubmit`, when creating (no `recordId`), pass the field only if set:
    ```ts
    else {
      const { medical_start_date, ...rest } = value as any;
      createMutation.mutate(
        medical_start_date ? { ...rest, medical_start_date } : rest
      );
    }
    ```
  - Render below the existing fields, create-mode only:
    ```tsx
    {!recordId && (
      <div className="space-y-2">
        <Label>{tMedical("employeeForm.medicalStartDate")}</Label>
        <form.Field name={"medical_start_date" as any}>
          {(field: any) => (
            <Input
              type="date"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          )}
        </form.Field>
      </div>
    )}
    ```
    with `const tMedical = useTranslations("medical");` added next to the existing `useTranslations` call.

- [ ] **Step 5: Typecheck.** `cd admin && bunx tsc --noEmit` → clean (baseline-equal). Fix any import-path mismatches (sheet/dialog/textarea live under `admin/components/ui/` — grep existing attestation pages for exact paths).

- [ ] **Step 6: Commit.**

```bash
git add "admin/app/[locale]/medical" admin/components/forms/attestation-employee/_form.tsx
git commit -m "feat(medical): detail sheet, complete/schedule dialogs, employee form field"
```

---

### Task 10: Local end-to-end verification

**Files:** none (verification only). Dev servers: backend `cd backend && bun run --watch src/index.ts`, admin `cd admin && bun dev` (port 6762). Use chrome-attach against `http://localhost:6762`.

- [ ] **Step 1:** `cd backend && bun test src/modules/medical/` → all pass. `bunx tsc --noEmit` in both `backend/` and `admin/` → clean.
- [ ] **Step 2 (HQ flow):** login as local admin → «Медосмотр» visible in top nav → page loads, tiles show counts, all employees `Нет графика`. Set schedule for one employee (start = today − 7 months) → row becomes «Просрочен», red tile count 1, red left border. Set another (start = today + 10 days) → «Скоро».
- [ ] **Step 3 (tiles + filters):** click red tile → only overdue rows; click again → filter clears. Search ФИО narrows; branch select narrows; reset clears all.
- [ ] **Step 4 (complete flow):** «Отметить» on the overdue row → dialog shows next-date preview → save with result «Годен» → row becomes «В норме», next due = completed + interval; Sheet shows history entry with recorded_by and the future projections.
- [ ] **Step 5 (unfit):** mark another exam «Не годен» → status «Не годен» red regardless of next date; included in red tile count.
- [ ] **Step 6 (employee form):** create employee with «Дата первого медосмотра» → appears in medical list with schedule; create one without → «Нет графика».
- [ ] **Step 7 (reschedule):** PUT via UI is not exposed (no UI button for reschedule — spec's open-row reschedule is API-only for now); verify `PUT /api/medical/exams/:id` with curl: moves the open date; 409 on a completed exam.
- [ ] **Step 8 (scope):** grant a test manager role `medical_layout` + `medical.list` only → sees own branch rows only, no action buttons, POST /medical/schedules returns 403 (no `medical.edit`).

---

### Task 11: Deploy to production (ONLY on explicit user authorization)

**Files:** prod server `choparpizza.uz` (`root`, key `~/.ssh/chopar_server`, path `/home/davr/managers`).

- [ ] **Step 1:** Ask the user for explicit deploy authorization. Do not proceed on an ambiguous reply.
- [ ] **Step 2:** Transfer changed files (scp or git bundle, matching the established flow): backend schema + migration + `src/lib/resolve-is-hq.ts` + `src/modules/medical/*` + `src/modules/attestation/controller.ts` + `src/controllers.ts`; admin messages ×4 (merge-script on prod for `ru.json` — it has a prod-only edit), `admin/app/[locale]/medical/*`, `main-nav.tsx` (prod copy is data-driven `nav` array — add entry there, do NOT overwrite), `manager-layout.tsx`, `admin/components/forms/attestation-employee/_form.tsx`, `admin/app/[locale]/attestation/employees/page.tsx` if touched. Commit on prod.
- [ ] **Step 3:** Run migration on prod (`bunx drizzle-kit migrate` from `/home/davr/managers/backend`) — review pending list first; this is a distinct hard-to-reverse action.
- [ ] **Step 4:** Seed permissions on prod (`bun run src/modules/medical/seed-permissions.ts`), grant `medical_layout`/`medical.list`/`medical.edit` to the admin role and `medical_layout`/`medical.list` to manager roles (SQL into `roles_permissions`).
- [ ] **Step 5:** Rebuild backend binary: `bun build --compile --minify-whitespace --minify-syntax --target bun --outfile app src/index.ts`; `pm2 restart office_api`. Rebuild admin with node20 PATH (`/root/.nvm/versions/node/v20.19.0/bin`): `bun run build`; `pm2 restart office_admin --update-env`; `pm2 save`.
- [ ] **Step 6:** Verify: `pm2 status` online; login 200; `/api/medical/summary` 200 with counts; медосмотр page renders; tile filter works.

---

## Self-Review

- Spec coverage: schema/lifecycle (T1, T4 schedules/complete), unfit first-class (T2 computeStatus + UI badge), status taxonomy + 30-day constant (T2), overdue-includes-unfit filter (T4 + T8 tileCount), endpoints incl. reschedule (T4, verified T10.7), employee-create integration (T5, T9), i18n ×4 (T6), top nav + manager tablet nav + layout gate (T7), tiles-as-filters/table/sheet/dialogs (T8–T9), tests + manual matrix (T2, T10), deploy gated on authorization (T11). ✓
- Placeholders: none — all code inline; two "grep the exact import path" fallbacks are explicit instructions, not gaps. ✓
- Type consistency: `MedicalRow` fields used in T8 match T4's map; `addMonthsClamped` duplicated client-side intentionally (preview only, server remains authoritative); dialog props match page state shapes. ✓
