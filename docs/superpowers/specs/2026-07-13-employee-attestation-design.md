# Employee Security Attestation — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending implementation plan
**Scope:** MVP = tests only (courses/lessons deferred)

## Problem

Restaurant/franchise chain needs to certify staff on technical/information security ("аттестация по безопасности"). Employees take tests on a **shared branch tablet** logged in under the single branch user account. Because identity is *asserted*, not *authenticated*, the core threat is **impersonation-for-sabotage**: employee A takes the test as employee B to tank B's score.

## Goals

1. Manage tests (CRUD, question bank) — central HQ authoring.
2. Employees take tests on a shared branch device with strong anti-impersonation.
3. Full attestation analytics (pass rates, per-employee / per-branch / per-test, expiry tracking).

## Non-goals (MVP)

- Courses / lessons / learning materials (deferred; schema leaves room).
- Per-answer explanation UI (field stored, not surfaced yet).
- iiko/external employee import (`external_id` column reserved; manual entry first).
- Selfie/biometric proctoring.

## Threat model & anti-impersonation

Shared account = broken audit trail (industry consensus: shared credentials record *when* and *what*, not *who*). Chosen defense = **two independent factors**, neither controlled by a would-be saboteur alone:

1. **Manager-launch (authorization + scoping):** only a branch account with `attestation.run` can open a test session and select the employee. A line cook cannot start a session at all.
2. **Personal PIN (authentication):** the selected employee enters their own PIN, verified server-side against `pin_hash`. Closes the "manager selects B then walks away, A answers" hole — A does not know B's PIN.

Supporting layers (auto-included, cheap, complementary):

- **One attempt** per (employee, test) until expired or HQ reset — prevents grind-to-pass and records a clean single record.
- **Timestamped audit:** every attempt stores `launched_by_user_id` (proctor), `terminal_id`, `started_at`, `submitted_at`.
- **PIN lockout:** after N failed PIN entries (default 5) the start is blocked; rate-limited.

Residual risk (accepted): manager and employee actively collude to cheat *up*. Out of scope — the stated concern is involuntary sabotage-down, which PIN + one-attempt defeats.

## Data model — 6 new tables in `backend/drizzle/schema.ts`

### `employees` — staff roster (NOT login users)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| first_name | text | |
| last_name | text | |
| position | text | job title |
| terminal_id | uuid → `terminals.id` | branch scoping |
| pin_hash | text | argon2/bcrypt hash of personal PIN; never returned |
| external_id | text nullable | future iiko import key |
| active | boolean | |
| created_at / updated_at | timestamptz | |

### `tests`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| description | text nullable | |
| passing_score | int | percent, e.g. 80 |
| time_limit_minutes | int nullable | null = no limit |
| questions_per_attempt | int nullable | bank sampling; null = all questions |
| shuffle_questions | boolean | default true |
| shuffle_options | boolean | default true |
| valid_months | int nullable | certificate validity; null = permanent (logic gated per rollout) |
| active | boolean | |
| created_at / updated_at | timestamptz | |

### `test_questions` — question bank per test
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| test_id | uuid → `tests.id` | |
| text | text | |
| type | enum `single` \| `multi` | grading mode |
| explanation | text nullable | future per-answer feedback |
| sort | int | authoring order |
| active | boolean | soft-disable without deleting history |

### `test_question_options`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| question_id | uuid → `test_questions.id` | |
| text | text | |
| is_correct | boolean | **server-only, never sent to take-test client** |
| sort | int | |

### `test_attempts` — one row per take
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| test_id | uuid → `tests.id` | |
| employee_id | uuid → `employees.id` | |
| terminal_id | uuid → `terminals.id` | where taken (denormalized) |
| launched_by_user_id | uuid → `users.id` | proctor / branch account |
| started_at | timestamptz | timer anchor |
| submitted_at | timestamptz nullable | |
| status | enum `in_progress` \| `submitted` \| `expired` | |
| score | int nullable | percent, server-graded |
| passed | boolean nullable | score ≥ test.passing_score |
| expires_at | timestamptz nullable | submitted_at + valid_months, if passed |
| question_ids | jsonb | sampled+shuffled set as asked (snapshot) |
| created_at | timestamptz | |

### `test_attempt_answers` — answer snapshot
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| attempt_id | uuid → `test_attempts.id` | |
| question_id | uuid → `test_questions.id` | reference |
| question_text | text | snapshot at time asked |
| selected_option_ids | jsonb | employee's choice(s) |
| is_correct | boolean | server-graded |

**Why snapshots:** HQ editing/deactivating a test later must not corrupt historical attempts or analytics. `question_text` + graded `is_correct` frozen on the attempt.

## Take-test flow (kiosk)

1. Branch account (`attestation.run`) opens kiosk page → fullscreen, no nav.
2. Selects active test + employee (roster filtered by `users_terminals`).
3. Employee enters personal PIN → `POST /attestation/attempts/start` verifies `pin_hash`. Wrong → increment fail counter, block after 5.
4. Server creates `test_attempts` (`in_progress`, `started_at`, `launched_by_user_id`), samples `questions_per_attempt` from the bank, shuffles per test flags, returns questions **with `is_correct` stripped**.
5. Client shows countdown (UX only). Authoritative timer = server: on submit, if `now > started_at + time_limit_minutes`, mark `expired` / auto-submit with answers received.
6. `POST /attestation/attempts/:id/submit` → server grades each answer (`type`-aware), computes `score`, `passed`, sets `expires_at` if passed, writes `test_attempt_answers` snapshots, sets `status='submitted'`.

## Retake / certification

- One live attempt per (employee, test). Starting a new attempt is rejected while an `in_progress` or `submitted` attempt exists, unless it is `expired` **or** HQ resets it (`attestation.reset`).
- Current certification for (employee, test) = latest `passed` attempt whose `expires_at` is in the future (or null when validity disabled).

## Backend module

`backend/src/modules/attestation/controller.ts` — Elysia plugin `@api/attestation`, `.use(ctx)`, registered in `backend/src/controllers.ts` via `.use(attestationController)` on `apiController`.

Endpoints (list endpoints follow `limit/offset/sort/filters/fields` convention, terminal-scoped via resolved `terminals`, per `reports` pattern):

- `tests` CRUD — `permission: "tests.*"`
- `test_questions` + `test_question_options` nested CRUD — `permission: "tests.edit"`
- `employees` CRUD — `permission: "employees.*"` (list scoped to caller's terminals; HQ spans all)
- `POST /attestation/attempts/start` — `permission: "attestation.run"`; verifies PIN, creates attempt, returns sanitized questions
- `POST /attestation/attempts/:id/submit` — `permission: "attestation.run"`; server-side grade
- `POST /attestation/attempts/:id/reset` — `permission: "attestation.reset"` (HQ)
- analytics GET endpoints — `permission: "attestation.analytics"`; terminal-scoped for branch, all for HQ

## Permission slugs (rows in `permissions.slug`; user assembles roles)

`tests.list` · `tests.one` · `tests.add` · `tests.edit` · `tests.delete`
`employees.list` · `employees.one` · `employees.add` · `employees.edit` · `employees.delete`
`attestation.run` · `attestation.reset` · `attestation.analytics`
`attestation_layout` (top-level admin layout gate)

## Admin UI

- `admin/components/layout/main-layout.tsx`: add `<CanAccess permission="attestation_layout">` wrapping a new `AttestationLayout`.
- Management pages (under `admin/app/[locale]/`): tests list + editor (question/option builder), employees roster CRUD.
- Kiosk: `admin/app/[locale]/attestation/kiosk` — fullscreen focused route, `<CanAccess permission="attestation.run">`, no chrome/nav.
- Analytics dashboard: pass rate, per-employee / per-branch / per-test breakdowns, score trend, "expired / due soon" list. Terminal-scoped.
- Eden client calls via `apiClient.api.attestation.*`.

## Security must-haves (do not regress)

- Take-test payload **strips `is_correct`** from options. Grading server-side only.
- Timer authoritative on server (`started_at` + limit); client countdown is cosmetic.
- PIN hashed (argon2 preferred), never returned in any response; start endpoint rate-limited with lockout.
- Attempt answers snapshotted (`question_text`, graded `is_correct`) so later test edits cannot rewrite history.

## Open items for the plan

- PIN format (length, digits-only) and lockout window duration.
- Analytics endpoint shapes (aggregate queries vs. computed client-side).
- i18n message keys for the 4 locales.
