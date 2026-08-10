// passportController / passportTgController are registered on the app root
// (backend/src/app.ts) with a widened `as unknown as Elysia` export, to stay
// under TypeScript's instantiation-depth limit (TS2589) — apiController's
// .use() chain was already at the limit, so the passport routes had to be
// registered outside it (see the comment above `passportControllerImpl` in
// backend/src/modules/passport/controller.ts, and the
// creditAdminController/iikoSyncController precedent). That widening means
// Eden's `treaty<App>()` can no longer infer `.passport.*` route types from
// `apiClient` — the routes are still real, live HTTP endpoints under
// `/api/passport/...`, just untyped from Eden's side.
//
// This file is the hand-typed wrapper, structured exactly like
// admin/lib/credit-api.ts: the underlying calls go through the same Eden proxy
// instance (so cookies/base URL/fetch config are unchanged), with one `as any`
// cast centralized here instead of scattered across every call site in the
// passport UI.
//
// !! DIFFERENCE FROM credit-api.ts, do not copy that idiom blindly !!
// credit's JSON routes declare `body: t.Object({ data: t.Object({...}) })`, so
// credit-api calls `.post({ data })` — which in Eden treaty2 sends
// `{"data":{...}}` on the wire, matching that schema. EVERY passport body
// schema is FLAT (`t.Object({ title_ru, ... })`), so passport wrappers pass the
// input object DIRECTLY: `.post(input)`, never `.post({ data: input })`.
// Wrapping would 422 on every create/update, and nothing type-checks it — the
// whole module is `any` past the cast.

import { apiClient } from "@admin/utils/eden";

const passportApi = (apiClient.api as any).passport;

// Matches the Eden treaty response envelope every generated call returns —
// keeps call sites' `const { data, error } = await listPrograms()`
// destructuring identical to what they'd get from a typed Eden call.
type EdenResult<T> = Promise<{ data: T | null; error: any }>;

// Every passport list route returns this envelope (`{total, data}`), the same
// convention the rest of this admin uses. `total` is a plain number here (the
// curriculum routes count in JS, not via pg count(*)), except for
// GET /passport/enrollments which coerces its pg count with Number() before
// returning — so it is a number there too.
export interface PassportListResponse<T> {
  total: number;
  data: T[];
}

// ---------------------------------------------------------------------------
// enums (backend/drizzle/schema.ts, pgEnum definitions)
// ---------------------------------------------------------------------------

export type PassportModuleStatus = "draft" | "review" | "published";

export type PassportVerificationType =
  | "quiz"
  | "observation"
  | "quiz_observation"
  | "quiz_observation_photo"
  | "dual";

export type PassportEnrollmentStatus =
  | "active"
  | "completed"
  | "failed"
  | "paused";

// The status filter shared by GET /passport/enrollments and GET /passport/matrix
// — same vocabulary AND same default on both, so one filter component can drive
// both screens. "live" (the DEFAULT when the param is omitted) = active+paused,
// i.e. who is training right now; "all" opts into history; the four enum values
// pick exactly one status. "live"/"all" are selection modes, NOT members of
// passport_enrollment_status — do not feed a raw row status into this type's
// place expecting a round trip.
export type PassportStatusFilter = "live" | "all" | PassportEnrollmentStatus;

export type PassportSignoffAction =
  | "material_opened"
  | "quiz_passed"
  | "quiz_failed"
  | "observed"
  | "observation_declined"
  | "recheck_passed"
  | "recheck_failed"
  | "level_set"
  | "level_rolled_back"
  | "stamp_issued";

// backend/src/modules/passport/deadline.ts — "warning" is < 3 days left.
export type PassportDeadlineStatus = "ok" | "warning" | "overdue";

// ---------------------------------------------------------------------------
// programs — GET/POST /passport/programs, PUT /passport/programs/:id
// GET is gated by passport.matrix.view; POST/PUT by passport.curriculum.publish
// ---------------------------------------------------------------------------

// The full passport_programs row: all three write routes `.returning()` the row.
export interface PassportProgram {
  id: string;
  // The job the program trains for — a free-text role name ("Повар", "Кассир"),
  // varchar(100). NOT a sort index, despite the name: the list route orders by
  // this column, so programs come back alphabetically by role.
  position: string;
  title_ru: string;
  title_uz: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PassportProgramCreateInput {
  position: string;
  title_ru: string;
  title_uz: string;
  active?: boolean;
}

export interface PassportProgramUpdateInput {
  position?: string;
  title_ru?: string;
  title_uz?: string;
  active?: boolean;
}

export function listPrograms(): EdenResult<
  PassportListResponse<PassportProgram>
> {
  return passportApi.programs.get();
}

export function createProgram(
  input: PassportProgramCreateInput
): EdenResult<PassportProgram> {
  return passportApi.programs.post(input);
}

export function updateProgram(
  id: string,
  input: PassportProgramUpdateInput
): EdenResult<PassportProgram> {
  return passportApi.programs({ id }).put(input);
}

// ---------------------------------------------------------------------------
// modules
// ---------------------------------------------------------------------------

// The full passport_modules row. `status` and `active` are orthogonal:
// `status` is the draft→review→published editorial state, `active` is the soft
// retirement flag (a published-but-inactive module is one nobody is fed any
// more). `parent_module_id` points at the ROOT of the version chain, never at
// the immediate parent.
export interface PassportModule {
  id: string;
  title_ru: string;
  title_uz: string;
  brand: string | null; // null | "chopar" | "les"
  owner_department: string;
  status: PassportModuleStatus;
  active: boolean;
  version: number;
  exam_test_id: string | null; // -> attestation_tests
  parent_module_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PassportModuleListQuery {
  program_id?: string;
  // Exact string "true" — the backend compares `query.include_inactive !== "true"`,
  // it is NOT a t.Boolean. Anything else (including the boolean true, which Eden
  // would serialize to "true"... but do not rely on that) keeps retired modules
  // hidden.
  include_inactive?: "true";
}

export interface PassportModuleCreateInput {
  title_ru: string;
  title_uz?: string;
  brand?: string | null;
  // Defaults to the caller's own users.department server-side; only a curriculum
  // admin (HR / super user / role "admin") may pass a foreign one.
  owner_department?: string;
  exam_test_id?: string | null;
}

export interface PassportModuleUpdateInput {
  title_ru?: string;
  title_uz?: string;
  brand?: string | null;
  owner_department?: string;
  exam_test_id?: string | null;
}

// Optional query keys are added conditionally rather than passed through as
// `undefined` — Eden's query serialization does not skip undefined values, it
// stringifies them to the literal "undefined", which for `program_id`
// (t.String({format:"uuid"})) would 422 the *default*, filter-less module list
// rather than only breaking once a filter is applied. Same rule credit-api's
// getStatement follows; centralized here so callers can pass a plain object
// with unset fields.
export function listModules(
  query: PassportModuleListQuery = {}
): EdenResult<PassportListResponse<PassportModule>> {
  const q: Record<string, string> = {};
  if (query.program_id) q.program_id = query.program_id;
  if (query.include_inactive) q.include_inactive = query.include_inactive;
  return passportApi.modules.get({ query: q });
}

export function createModule(
  input: PassportModuleCreateInput
): EdenResult<PassportModule> {
  return passportApi.modules.post(input);
}

export function updateModule(
  id: string,
  input: PassportModuleUpdateInput
): EdenResult<PassportModule> {
  return passportApi.modules({ id }).put(input);
}

// draft -> review. 409 if the module is not a draft.
export function submitModuleReview(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id })["submit-review"].post();
}

// The 422 body of POST /passport/modules/:id/publish: the module failed
// validateModuleForPublish (missing uz translation, no topics, unsignable
// verification type, ...). Each string is a human-readable reason and the UI
// must list them all — see publishErrors() below.
export interface PassportPublishErrors {
  errors: string[];
}

// -> published (and always un-hides: active is forced true).
// 404 unknown, 409 already published, 422 {errors:[...]} incomplete content.
export function publishModule(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id }).publish.post();
}

// Several routes refuse with a machine-readable `code` on top of the human
// message. Curriculum: "module_in_use" (someone already has progress —
// deactivate, or publish a new version, instead), "module_in_use_in_program",
// "not_published", "module_not_found", "link_not_found", each of the in-use
// ones carrying `progress_rows`. Mentors: "user_not_found",
// "telegram_bound_to_trainee", "telegram_bound_to_other_user",
// "bad_telegram_id", "binding_not_found", "binding_is_trainee", carrying
// `telegram_id` and (for the occupied case) the occupying `user_id`.
// Read the code with refusalCode() and branch the UI on it, never on the prose.
export interface PassportRefusal {
  message: string;
  code?: string;
  status?: PassportModuleStatus;
  progress_rows?: number;
  telegram_id?: number;
  user_id?: string;
}

// published -> draft, the repair path for a mistaken publish. Refused (409
// code:"module_in_use") once any trainee has progress on the module.
export function unpublishModule(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id }).unpublish.post();
}

// Soft retirement: hides the module from the trainee feed and from the default
// builder listing, leaves every enrollment/progress/sign-off untouched.
// Idempotent — deactivating twice is a no-op, not a 409.
export function deactivateModule(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id }).deactivate.post();
}

// The counterpart of deactivateModule. Not in the task brief's export list, but
// the endpoint exists (POST /passport/modules/:id/activate) and the builder
// needs it to un-retire a module — a retired module is otherwise only
// reachable via ?include_inactive=true with no way back.
export function activateModule(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id }).activate.post();
}

// A published module is frozen; changing it means forking a fresh draft copy
// (topics included, version+1, active forced true). 409 unless published.
export function newModuleVersion(id: string): EdenResult<PassportModule> {
  return passportApi.modules({ id })["new-version"].post();
}

// ---------------------------------------------------------------------------
// topics
// ---------------------------------------------------------------------------

// The design doc's TWI card: step / key point / reason, each in both languages.
export interface PassportObservationChecklistItem {
  ru: string;
  uz: string;
}

// jsonb, shape per the design doc §4. Kept loose (optional arrays) because the
// backend stores it with t.Any() and never validates the inner shape.
export interface PassportObservationChecklist {
  items?: PassportObservationChecklistItem[];
  questions?: PassportObservationChecklistItem[];
}

export interface PassportTopic {
  id: string;
  module_id: string;
  sort: number;
  title_ru: string;
  title_uz: string;
  step_ru: string;
  step_uz: string;
  key_point_ru: string;
  key_point_uz: string;
  reason_ru: string;
  reason_uz: string;
  video_id: string | null; // -> passport_media
  verification_type: PassportVerificationType;
  quiz_test_id: string | null; // -> attestation_tests
  observation_checklist: PassportObservationChecklist | null;
  active: boolean;
}

export interface PassportTopicCreateInput {
  module_id: string;
  sort?: number;
  title_ru: string;
  title_uz?: string;
  step_ru?: string;
  step_uz?: string;
  key_point_ru?: string;
  key_point_uz?: string;
  reason_ru?: string;
  reason_uz?: string;
  video_id?: string | null;
  verification_type?: PassportVerificationType;
  quiz_test_id?: string | null;
  observation_checklist?: PassportObservationChecklist | null;
  active?: boolean;
}

// No module_id: a topic never moves between modules (PUT /passport/topics/:id
// has no module_id in its body schema).
export type PassportTopicUpdateInput = Omit<
  PassportTopicCreateInput,
  "module_id" | "title_ru"
> & { title_ru?: string };

// GET /passport/modules/:id/topics — returns ALL topics of the module,
// inactive ones included, ordered by sort. (The publish validator is the only
// place that filters to active.)
export function listTopics(
  moduleId: string
): EdenResult<PassportListResponse<PassportTopic>> {
  return passportApi.modules({ id: moduleId }).topics.get();
}

export function createTopic(
  input: PassportTopicCreateInput
): EdenResult<PassportTopic> {
  return passportApi.topics.post(input);
}

export function updateTopic(
  id: string,
  input: PassportTopicUpdateInput
): EdenResult<PassportTopic> {
  return passportApi.topics({ id }).put(input);
}

// ---------------------------------------------------------------------------
// program <-> module links (HR only, passport.curriculum.publish)
// ---------------------------------------------------------------------------

export interface PassportProgramModule {
  id: string;
  program_id: string;
  module_id: string;
  sort: number;
  required: boolean;
  deadline_days: number | null;
}

export interface PassportProgramModuleInput {
  program_id: string;
  module_id: string;
  sort?: number;
  required?: boolean;
  deadline_days?: number | null;
}

export interface PassportProgramModuleDeleted {
  deleted: true;
  id: string;
  program_id: string;
  module_id: string;
}

// POST is an upsert on (program_id, module_id) — re-posting an existing pair
// updates sort/required/deadline_days rather than 409-ing, so the builder can
// use it for both "attach" and "re-order/re-configure".
export function upsertProgramModule(
  input: PassportProgramModuleInput
): EdenResult<PassportProgramModule> {
  return passportApi["program-modules"].post(input);
}

// DELETE **with a body** — the route is `DELETE /passport/program-modules`
// with `body: t.Object({program_id, module_id})`, not a path param. There is no
// precedent for a bodied DELETE elsewhere in this admin (credit-api's
// deleteDocument sends none), so this exact wire shape is the one call here
// that is unverified until the curriculum builder exercises it live.
// Refused 409 (code "module_in_use_in_program") while active trainees of this
// program have progress on the module.
export function deleteProgramModule(input: {
  program_id: string;
  module_id: string;
}): EdenResult<PassportProgramModuleDeleted> {
  return passportApi["program-modules"].delete(input);
}

// ---------------------------------------------------------------------------
// enrollments
// ---------------------------------------------------------------------------

// The raw passport_enrollments row — what POST /enrollments nests under
// `enrollment` and what /close returns.
export interface PassportEnrollment {
  id: string;
  employee_id: string;
  program_id: string;
  terminal_id: string;
  status: PassportEnrollmentStatus;
  started_at: string;
  probation_deadline: string | null;
  completed_at: string | null;
  created_by_user_id: string;
  created_at: string;
}

// GET /passport/enrollments' explicit select() — a left join against employees
// and passport_programs, so every joined column is nullable. NOT the same shape
// as PassportEnrollment (no created_by_user_id).
export interface PassportEnrollmentRow {
  id: string;
  employee_id: string;
  program_id: string;
  terminal_id: string;
  status: PassportEnrollmentStatus;
  started_at: string;
  probation_deadline: string | null;
  completed_at: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  program_title_ru: string | null;
  program_title_uz: string | null;
}

export interface PassportEnrollmentListQuery {
  limit?: string;
  offset?: string;
  // Omitted means "live" (active+paused), NOT "everything" — see
  // PassportStatusFilter. Pass "all" for the full history.
  status?: PassportStatusFilter;
  terminal_id?: string;
  employee_id?: string;
  program_id?: string;
}

export interface PassportEnrollmentCreateInput {
  employee_id: string;
  // terminal_id is NOT accepted: the backend takes it from the employee, so a
  // branch HR cannot park a trainee in someone else's branch.
  program_id: string;
  probation_days: number; // 1..365
}

// invite_id is the QR payload:
// https://t.me/<PASSPORT_BOT>?startapp=inv_<invite_id>
export interface PassportEnrollmentCreated {
  enrollment: PassportEnrollment;
  invite_id: string;
  invite_expires_at: string;
}

// The 409 body of POST /passport/enrollments: the employee already has an open
// (active|paused) enrollment. One trainee = one live passport; the intended
// moves are reinvite() or closeEnrollment(). The id fields are present only
// when the conflicting enrollment is inside the caller's terminal scope — for
// a transferred employee the body is the bare cross-branch message.
export interface PassportEnrollmentConflict {
  message: string;
  enrollment_id?: string;
  program_id?: string;
  status?: PassportEnrollmentStatus;
}

export interface PassportReinviteResult {
  invite_id: string;
  expires_at: string;
  revoked: number; // how many live unused invites were backdated
}

// Same conditional-query rule as listModules: `terminal_id`/`employee_id`/
// `program_id` are uuid-formatted and `status` is a literal union server-side,
// so a single stringified `undefined` would 422 the default unfiltered list.
export function listEnrollments(
  query: PassportEnrollmentListQuery = {}
): EdenResult<PassportListResponse<PassportEnrollmentRow>> {
  const q: Record<string, string> = {};
  if (query.limit) q.limit = query.limit;
  if (query.offset) q.offset = query.offset;
  if (query.status) q.status = query.status;
  if (query.terminal_id) q.terminal_id = query.terminal_id;
  if (query.employee_id) q.employee_id = query.employee_id;
  if (query.program_id) q.program_id = query.program_id;
  return passportApi.enrollments.get({ query: q });
}

export function createEnrollment(
  input: PassportEnrollmentCreateInput
): EdenResult<PassportEnrollmentCreated> {
  return passportApi.enrollments.post(input);
}

export function closeEnrollment(
  id: string,
  result: "completed" | "failed"
): EdenResult<PassportEnrollment> {
  return passportApi.enrollments({ id }).close.post({ result });
}

// Revokes every live unused invite of the enrollment and issues a fresh one.
// 409 if the enrollment is already closed.
export function reinvite(id: string): EdenResult<PassportReinviteResult> {
  return passportApi.enrollments({ id }).reinvite.post();
}

// ---------------------------------------------------------------------------
// progress matrix — GET /passport/matrix (permission passport.matrix.view)
//
// Rows are trainees, columns are the modules of their program, every cell
// arrives pre-aggregated. The UI paints chips and dates and re-derives NOTHING:
// `level_min`, `complete` and `deadline_status` are all computed server-side by
// the same `deadlineStatus()` the miniapp feed uses, so a module the trainee
// sees as overdue on their phone is red in HR's grid too.
//
// !! GRID KEYING !! `modules` is a flat list of (program_id, module_id) PAIRS,
// not a list of modules — `sort`, `required` and `deadline_days` live on
// passport_program_modules, so one module attached to two programs is
// legitimately two columns with different settings. A grid MUST key its columns
// on `${program_id}:${module_id}`; keying on module_id alone collides the
// moment the rows span more than one program. Select a row's columns with
// `column.program_id === row.program_id`.
//
// Columns are published AND active modules only (exactly the trainee /me
// filter), so a module HR retires leaves the grid and the row totals move with
// it — deliberate: HR sees the curriculum actually being fed. The retired
// module's progress rows and sign-offs stay readable in the journal.
// ---------------------------------------------------------------------------

// One COLUMN of the grid, i.e. one row of passport_program_modules joined to
// its module. Note there is NO `id` field — the identity is the
// (program_id, module_id) pair.
export interface PassportMatrixModule {
  program_id: string;
  module_id: string;
  title_ru: string;
  title_uz: string;
  sort: number;
  required: boolean;
  deadline_days: number | null;
}

export interface PassportMatrixEmployee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
}

// One trainee × one column.
//
// `level_min` is the weakest level across the module's active topics — the cell
// colour: 1 "увидел" grey, 2 "сделал" amber, 3 "сам" green, 4 "учит" accent.
// It is **null, not 0**, for a module with no active topics at all: paint an
// empty cell, not a grey "level 0" chip that reads as "this trainee has done
// nothing". `complete` means every topic reached level >= 3 (level 3 "does it
// alone" is the bar; 4 is above it). `deadline_status: "overdue"` is red and
// wins over the level colour — but note a COMPLETE module can still carry
// "overdue" here while being excluded from `totals.overdue_modules`.
export interface PassportMatrixCell {
  module_id: string;
  topics_total: number;
  topics_done: number;
  level_min: number | null;
  complete: boolean;
  required: boolean;
  deadline_days: number | null;
  deadline_at: string | null;
  deadline_status: PassportDeadlineStatus;
}

// The compact metrics strip above/beside the grid. Defined over the VISIBLE
// columns, so retiring a module moves these numbers.
export interface PassportMatrixTotals {
  modules_total: number;
  modules_done: number;
  topics_total: number;
  topics_done: number;
  // Counts only modules that are BOTH overdue and not complete — what still
  // needs chasing, not what merely ran past its date.
  overdue_modules: number;
}

export interface PassportMatrixRow {
  enrollment_id: string;
  program_id: string;
  program_title_ru: string | null;
  program_title_uz: string | null;
  employee: PassportMatrixEmployee;
  terminal_id: string;
  terminal_name: string | null;
  // The code of the organization owning the trainee's terminal
  // ("chopar" | "les") — not a column on employees or enrollments.
  brand: string | null;
  status: PassportEnrollmentStatus;
  started_at: string;
  probation_deadline: string | null;
  completed_at: string | null;
  totals: PassportMatrixTotals;
  cells: PassportMatrixCell[];
}

export interface PassportMatrixResponse {
  total: number;
  modules: PassportMatrixModule[];
  rows: PassportMatrixRow[];
}

export interface PassportMatrixQuery {
  limit?: string; // default 100, capped at 200
  offset?: string;
  brand?: string;
  terminal_id?: string;
  program_id?: string;
  position?: string;
  // Omitted means "live" — same vocabulary and same default as listEnrollments,
  // so one filter component drives both screens.
  status?: PassportStatusFilter;
}

// Non-HQ callers are terminal-scoped, and an empty scope yields an empty result
// (fail-closed), same as listEnrollments. Rows are ordered last name, first
// name, enrollment id — stable across pages.
export function getMatrix(
  query: PassportMatrixQuery = {}
): EdenResult<PassportMatrixResponse> {
  const q: Record<string, string> = {};
  if (query.limit) q.limit = query.limit;
  if (query.offset) q.offset = query.offset;
  if (query.brand) q.brand = query.brand;
  if (query.terminal_id) q.terminal_id = query.terminal_id;
  if (query.program_id) q.program_id = query.program_id;
  if (query.position) q.position = query.position;
  if (query.status) q.status = query.status;
  return passportApi.matrix.get({ query: q });
}

// ---------------------------------------------------------------------------
// enrollment journal — GET /passport/enrollments/:id/journal
// (permission passport.matrix.view, same terminal scope as the sign-off route:
// 404 unknown, 403 another branch's trainee)
//
// passport_signoffs is append-only and this is the only way HR reads it: who
// certified what, from which IP, when. There is NO status filter of any kind —
// the journal is history, so a completed/failed/paused enrollment still returns
// its rows, and rows about a since-deactivated module stay readable.
// ---------------------------------------------------------------------------

// The topic/module a journal row refers to. `topic_id`/`module_id` are plain
// uuids with no FK, so a row about a hard-deleted topic still appears with null
// titles rather than vanishing from the evidence — hence nullable titles on a
// non-null ref.
export interface PassportJournalRef {
  id: string;
  title_ru: string | null;
  title_uz: string | null;
}

// "office" = an admin/mentor acting through this panel, "trainee" = the phone,
// `null` kind = a system-written row. `name` is already resolved server-side
// (users fall back to their login) — do not fetch the users table to render it.
export interface PassportJournalActor {
  kind: "office" | "trainee" | null;
  user_id: string | null;
  employee_id: string | null;
  name: string | null;
}

// NOTE the nesting: `topic` and `module` are objects (or null), NOT flat
// `topic_id`/`topic_title_ru` fields.
export interface PassportJournalEntry {
  id: string;
  created_at: string;
  action: PassportSignoffAction;
  topic: PassportJournalRef | null;
  module: PassportJournalRef | null;
  actor: PassportJournalActor;
  terminal_id: string | null;
  ip: string | null;
  meta: unknown;
}

// Context for the header of the journal drawer, so the UI does not need a
// second call to name the enrollment it is showing. This is why the journal
// does NOT use the generic PassportListResponse envelope.
export interface PassportJournalEnrollment {
  id: string;
  employee_id: string;
  program_id: string;
  terminal_id: string;
  status: PassportEnrollmentStatus;
  started_at: string;
}

export interface PassportJournalResponse {
  total: number;
  enrollment: PassportJournalEnrollment;
  data: PassportJournalEntry[];
}

export interface PassportJournalQuery {
  limit?: string; // default 50, capped at 200
  offset?: string;
}

// Newest first, id breaking ties so two events written in the same millisecond
// keep a stable order across pages.
export function getJournal(
  enrollmentId: string,
  query: PassportJournalQuery = {}
): EdenResult<PassportJournalResponse> {
  const q: Record<string, string> = {};
  if (query.limit) q.limit = query.limit;
  if (query.offset) q.offset = query.offset;
  return passportApi.enrollments({ id: enrollmentId }).journal.get({ query: q });
}

// ---------------------------------------------------------------------------
// mentor telegram bindings — /passport/mentors
// (permission passport.mentors.manage)
//
// A trainee gets their binding by scanning a QR; a mentor has no QR and no
// invite, so without a row here a branch manager cannot log into the miniapp AT
// ALL. Mentor = `user_id` set and `employee_id` null — that null IS the role,
// and the list filters on the pair, not on user_id alone.
//
// !! The LIST and the CREATE responses are DIFFERENT SHAPES. The list renames
// the binding's own telegram-supplied name to `tg_first_name` and nests the
// resolved office user under `user`; create/update returns the raw table row
// (where the field is `first_name`) plus a `created` flag. One interface cannot
// describe both — they are separate types below.
// ---------------------------------------------------------------------------

// The office user a binding points at, resolved by the list route.
export interface PassportMentorUser {
  id: string;
  login: string | null;
  first_name: string | null;
  last_name: string | null;
  status: "active" | "blocked" | "inactive" | null;
  // first+last, falling back to login — already computed, render as-is.
  name: string | null;
}

// A row of GET /passport/mentors.
export interface PassportMentorRow {
  id: string;
  telegram_id: number;
  user_id: string | null;
  // The name TELEGRAM gave us when this account last authenticated — empty
  // until the mentor's first login, which is itself the signal HR wants
  // ("did he ever actually get in?"). NOT the office user's name; that is
  // `user.name`.
  tg_first_name: string;
  lang: string; // "ru" | "uz"
  banned: boolean;
  created_at: string;
  user: PassportMentorUser | null;
}

export interface PassportMentorListQuery {
  limit?: string; // default 100, capped at 200
  offset?: string;
  user_id?: string;
}

// The response of POST /passport/mentors: the raw passport_tg_bindings row
// (so `first_name`, not `tg_first_name`, and no nested `user`) plus `created` —
// false when an existing binding for the same user was updated instead of
// inserted. Re-binding the same pair is idempotent, and `banned` is
// deliberately NOT cleared by it (un-banning is its own decision).
export interface PassportMentorBinding {
  created: boolean;
  id: string;
  telegram_id: number;
  employee_id: string | null; // always null for a mentor
  user_id: string | null;
  first_name: string;
  lang: string;
  banned: boolean;
  created_at: string;
}

export interface PassportMentorCreateInput {
  user_id: string;
  // bigint read in JS number mode; the route bounds it at Number.MAX_SAFE_INTEGER.
  telegram_id: number;
  lang?: "ru" | "uz";
}

export interface PassportMentorDeleted {
  deleted: true;
  id: string;
  telegram_id: number;
  user_id: string | null;
}

export function listMentors(
  query: PassportMentorListQuery = {}
): EdenResult<PassportListResponse<PassportMentorRow>> {
  const q: Record<string, string> = {};
  if (query.limit) q.limit = query.limit;
  if (query.offset) q.offset = query.offset;
  if (query.user_id) q.user_id = query.user_id;
  return passportApi.mentors.get({ query: q });
}

// 404 code:"user_not_found"; 409 code:"telegram_bound_to_trainee" (that
// telegram account is a TRAINEE's — binding it as a mentor would flip its role,
// cost the trainee their passport and hand sign-off reach to whoever holds the
// phone); 409 code:"telegram_bound_to_other_user" (unbind it first). Read the
// code with refusalCode(); the 409 payloads also carry telegram_id, and the
// other-user one carries the occupying user_id.
export function createMentor(
  input: PassportMentorCreateInput
): EdenResult<PassportMentorBinding> {
  return passportApi.mentors.post(input);
}

// telegram_id is a PATH param, not a body field. 422 code:"bad_telegram_id",
// 404 code:"binding_not_found", 409 code:"binding_is_trainee" — this surface
// never unbinds a trainee in either direction.
//
// KNOWN GAP inherited from the backend: an already-issued miniapp session lives
// in Redis for up to 12h and is not re-checked against this table, so access
// ends within that window rather than instantly. Do not promise the user
// immediate revocation in the UI copy.
export function deleteMentor(
  telegramId: number | string
): EdenResult<PassportMentorDeleted> {
  return passportApi.mentors({ telegram_id: String(telegramId) }).delete();
}

// ---------------------------------------------------------------------------
// structured-error helpers
//
// Eden puts a non-2xx response body on `error.value`. These three exist so the
// pages do not each have to know that, and — more importantly — so the
// actionable payloads below are surfaced instead of collapsing into a generic
// "something went wrong" toast.
// ---------------------------------------------------------------------------

// The 422 from publishModule(): every reason the module cannot go live, e.g.
// ["Тема «Раскатка теста»: не заполнен перевод (uz)"]. Returns null for any
// other failure, so `publishErrors(error) ?? genericMessage(error)` is the
// intended call shape.
export function publishErrors(error: any): string[] | null {
  const errors = error?.value?.errors;
  return Array.isArray(errors) ? (errors as string[]) : null;
}

// The 409 from createEnrollment(): the employee's existing open enrollment.
export function enrollmentConflict(
  error: any
): PassportEnrollmentConflict | null {
  const v = error?.value;
  if (!v || typeof v.message !== "string") return null;
  return v as PassportEnrollmentConflict;
}

// The machine-readable `code` on a refusal — see PassportRefusal for the full
// list across curriculum (unpublish / deleteProgramModule) and mentors
// (createMentor / deleteMentor). Lets the UI offer the right next action
// ("deactivate instead", "unbind it first") rather than echoing English prose
// written for a developer.
export function refusalCode(error: any): string | null {
  const code = error?.value?.code;
  return typeof code === "string" ? code : null;
}
