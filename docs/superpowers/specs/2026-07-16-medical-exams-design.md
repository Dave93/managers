# Medical Examination (Медосмотр) Tracking — Design

**Date:** 2026-07-16
**Status:** Approved (design)

## Problem

Restaurant employees must pass a periodic medical examination (медосмотр). The office needs a
dedicated section to track who has passed, who is overdue, and when each employee is due next.
Admin sets a start date per employee; the system maintains a recurring schedule (default every
6 months) and flags overdue/upcoming exams visually. Branch managers see their own branch
read-only. The employee create form gains an optional "first exam date" field.

Research notes (Uzbekistan): the full physician exam is annual, while bacteriological/sanitary
lab screening tied to the санитарная книжка is twice-yearly (MoH Order No. 2387; Labor Code
Arts. 357/360). Certificate validity legally runs from the actual exam date. Hence: interval is
configurable (default 6 months) and the next due date anchors to the actual completion date.

## Decisions

- **Completion record:** actual date + result (fit / fit with restrictions / unfit) + optional note.
- **Anchoring:** next due = `completed_date + interval_months` (floating). Overdue detection
  compares today against `planned_due_date` — lateness stays visible against the plan.
- **Interval:** per-schedule `interval_months`, default 6.
- **Access:** HQ (super user or `attestation.hq`) sees and manages all branches; branch managers
  see only their branch, read-only. Marking exams complete is HQ/office only (`medical.edit`).
- **Navigation:** separate top-level section «Медосмотр» (own layout permission), not under
  Аттестация. Tablet ManagerLayout gets a read-only entry.
- **Data model:** hybrid — a schedule row is the source of truth; one materialized exam row per
  cycle; future dates beyond the open cycle are projected on the fly (no pre-generated N-year dump).

## Data model (Drizzle, `backend/drizzle/schema.ts`)

```
medical_exam_result enum: 'fit' | 'fit_restricted' | 'unfit'

medical_exam_schedules
  id uuid PK default random
  employee_id uuid NOT NULL → employees.id, UNIQUE (one schedule per employee)
  start_date date NOT NULL
  interval_months integer NOT NULL DEFAULT 6
  active boolean NOT NULL DEFAULT true
  created_at / updated_at timestamptz

medical_exams
  id uuid PK default random
  schedule_id uuid NOT NULL → medical_exam_schedules.id
  employee_id uuid NOT NULL → employees.id   (denormalized for fast joins)
  planned_due_date date NOT NULL
  completed_date date            (null = open cycle)
  result medical_exam_result     (null until completed)
  notes text
  recorded_by uuid → users.id    (who marked it)
  created_at / updated_at timestamptz
```

Lifecycle:
1. Create schedule → if `start_date` ≤ today, the starting exam was already passed: insert a
   completed row (`completed_date = start_date`, result null = «стартовая отметка») plus the next
   open row at `start_date + interval`; if `start_date` is in the future, insert one open row with
   `planned_due_date = start_date`.
2. Mark complete (date, result, notes) → close the open row, insert the next row with
   `planned_due_date = completed_date + interval_months`.
3. Exactly one open (uncompleted) row per active schedule at all times.
4. Future calendar beyond the open row is computed (open due + n×interval), never persisted.
5. Editing `start_date`/`interval_months` updates the open row's `planned_due_date` only if the
   open row is the first (no completions yet); otherwise only future projections shift.
6. `result = 'unfit'` is a first-class critical state — employee flagged red regardless of dates
   (legally barred from work).

## Status taxonomy (computed, shared pure function)

| Status | Rule | Visual |
|---|---|---|
| `unfit` | latest completed result = unfit | red badge «Не годен» |
| `overdue` | open `planned_due_date` < today | red badge «Просрочен», «просрочен N дн» |
| `due_soon` | due within 30 days | amber badge «Скоро», «через N дн» |
| `ok` | due in > 30 days | green badge «В норме» |
| `none` | no schedule | gray badge «Нет графика» |

Threshold 30 days — a named constant (`DUE_SOON_DAYS`), not user-configurable.

## Backend (`backend/src/modules/medical/controller.ts`)

New permissions (seed script, same pattern as attestation): `medical_layout`, `medical.list`,
`medical.edit`. HQ resolution reuses `resolveIsHq` (super user or `attestation.hq`); non-HQ scope
= `inArray(employees.terminal_id, terminals)`.

- `GET /medical/exams` — `medical.list`. One row per employee (active employees with or without
  schedule): employee fields, terminal, last completed date/result, open planned_due_date,
  computed status. Query: `limit`, `offset`, `search` (ilike first/last name), `terminal_id`,
  `status` (one of the taxonomy values; `status=overdue` also includes `unfit` rows so the red
  tile and the filter show the same set). Default order: urgency (unfit, overdue, due_soon, ok,
  none), then due date asc.
- `GET /medical/summary` — `medical.list`, scope-aware counts per status bucket.
- `GET /medical/employees/:id` — `medical.list` + scope check. Returns schedule, full exam
  history (desc), and 5-year projection of future planned dates.
- `POST /medical/schedules` — `medical.edit`. Body: `employee_id`, `start_date`,
  `interval_months` (default 6). Upsert: creates schedule + first open exam row, or updates
  existing schedule per lifecycle rule 5. Scope check on the employee's terminal.
- `POST /medical/exams/:id/complete` — `medical.edit`. Body: `completed_date` (≤ today),
  `result`, `notes?`. Closes row (sets `recorded_by`), inserts next cycle. 409 if already completed.
- `PUT /medical/exams/:id` — `medical.edit`. Body: `planned_due_date`. Reschedules the single
  open row only; 409 if completed.

Pure logic in `backend/src/modules/medical/status.ts` (+ bun:test): `computeStatus`,
`nextDueDate(completed, intervalMonths)`, `projectFutureDates(from, intervalMonths, years)`.
Month addition via date-fns `addMonths` semantics (clamp to end of month).

## Frontend (`admin/app/[locale]/medical/`)

Own nested layout (`layout.tsx`) gated by `medical_layout`; top-nav entry «Медосмотр» in
main-nav (same gating pattern as Аттестация dropdown). ManagerLayout bottom-nav item gated by
`medical.list` for tablet read-only view.

**List page (`page.tsx`):**
- 4 KPI tiles (Card): Просрочено (red), Скоро (amber), В норме (green), Без графика (gray) —
  counts from `/medical/summary`; each tile is a toggle that sets the `status` filter on the
  table (pressed visual state; unfit included in the Просрочено tile count, badge still «Не годен»).
- Toolbar: debounced ФИО search, terminal select (sorted by name), reset.
- TanStack table: Сотрудник | Филиал | Должность | Последний осмотр | Следующий | Статус
  (Badge, color per taxonomy, text label always) | относительный срок («через 12 дн» /
  «просрочен 5 дн») | Действия. Overdue/unfit rows get a subtle red left border, no full-row fill.
- Actions (CanAccess `medical.edit`): «Отметить» (complete dialog), «График» (schedule dialog).

**Detail Sheet** (row click, right side): employee name + status badge; vertical timeline —
future projections (muted, top), open cycle («Следующий: <date>»), history entries below (date,
result badge, recorded_by, notes). Footer buttons (CanAccess `medical.edit`): «Отметить осмотр»,
«Изменить график».

**Complete dialog:** date picker (default today, max today), result select (годен / годен с
ограничениями / не годен), notes textarea, read-only computed line «Следующий осмотр: <date>».

**Schedule dialog:** start_date picker + interval_months number input (default 6).

**Employee form (attestation employees page):** optional «Дата первого медосмотра» date field in
the create sheet; when set, backend `POST /attestation/employees` also creates the medical
schedule (transactionally). Edit form does not manage the schedule (done from the medical section).

## i18n

`medical.*` namespace in all 4 locales (en, ru, uz-Latn, uz-Cyrl): nav, statuses, table headers,
dialogs, tiles, relative-time strings.

## Testing

- bun:test on `status.ts`: status buckets incl. boundary days, unfit precedence, nextDueDate
  month-end clamping, projection count.
- Manual: HQ full flow (create schedule → complete → next cycle appears), manager scope
  (own branch only, no edit buttons), tile filters, employee-form start date creates schedule.

## Non-goals

- No certificate file uploads (no file storage in project).
- No email/push reminders — visual flagging only.
- No multiple exam types per employee (configurable interval covers future needs).
- No export, no pagination changes beyond standard limit/offset.
