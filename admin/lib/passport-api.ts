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

// The 409 refusal bodies of unpublish / DELETE program-modules carry a machine
// `code` on top of the human message — "module_in_use" (someone already has
// progress; deactivate or publish a new version instead),
// "module_in_use_in_program", "not_published", "module_not_found",
// "link_not_found" — plus `progress_rows` on the in-use ones.
export interface PassportRefusal {
  message: string;
  code?: string;
  status?: PassportModuleStatus;
  progress_rows?: number;
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
  status?: PassportEnrollmentStatus;
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
// PENDING — matrix / journal / mentors
//
// These four endpoints DO NOT EXIST on the backend yet. They are being added by
// task B2 (`GET /passport/matrix`, `GET /passport/enrollments/:id/journal`,
// `GET|POST /passport/mentors`, `DELETE /passport/mentors/:telegram_id`), and
// the shapes below are transcribed from that task's brief, not from a
// controller that has been read. Treat them as provisional: re-check them
// against backend/src/modules/passport/controller.ts once B2 lands, before the
// matrix/mentors UI relies on a field name. Calling them today returns 404.
// ---------------------------------------------------------------------------

export interface PassportMatrixModule {
  id: string;
  title_ru: string;
  title_uz: string;
  sort: number;
}

export interface PassportMatrixEmployee {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
}

// One trainee × one module. `level_min` is the weakest level across the
// module's topics (0..4) — the cell colour: 1 "увидел" grey, 2 "сделал" amber,
// 3 "сам" green, 4 "учит" accent; `deadline_status: "overdue"` is red and wins.
export interface PassportMatrixCell {
  module_id: string;
  topics_total: number;
  topics_done: number;
  level_min: number;
  deadline_at: string | null;
  deadline_status: PassportDeadlineStatus;
}

export interface PassportMatrixRow {
  enrollment_id: string;
  employee: PassportMatrixEmployee;
  terminal_id: string;
  started_at: string;
  probation_deadline: string | null;
  cells: PassportMatrixCell[];
}

export interface PassportMatrixResponse {
  modules: PassportMatrixModule[];
  rows: PassportMatrixRow[];
}

export interface PassportMatrixQuery {
  brand?: string;
  terminal_id?: string;
  position?: string;
  status?: PassportEnrollmentStatus;
}

// PENDING (B2). Non-HQ callers are terminal-scoped and an empty scope yields an
// empty result (fail-closed), same as listEnrollments.
export function getMatrix(
  query: PassportMatrixQuery = {}
): EdenResult<PassportMatrixResponse> {
  const q: Record<string, string> = {};
  if (query.brand) q.brand = query.brand;
  if (query.terminal_id) q.terminal_id = query.terminal_id;
  if (query.position) q.position = query.position;
  if (query.status) q.status = query.status;
  return passportApi.matrix.get({ query: q });
}

// PENDING (B2). A passport_signoffs row with the actor's name resolved.
export interface PassportJournalEntry {
  id: string;
  enrollment_id: string;
  topic_id: string | null;
  module_id: string | null;
  action: PassportSignoffAction;
  actor_user_id: string | null;
  actor_employee_id: string | null;
  actor_name: string | null;
  terminal_id: string | null;
  ip: string | null;
  meta: unknown;
  created_at: string;
}

export interface PassportJournalQuery {
  limit?: string;
  offset?: string;
}

// PENDING (B2). Freshest first, terminal-scoped like the matrix (403 on another
// branch's enrollment).
export function getJournal(
  enrollmentId: string,
  query: PassportJournalQuery = {}
): EdenResult<PassportListResponse<PassportJournalEntry>> {
  const q: Record<string, string> = {};
  if (query.limit) q.limit = query.limit;
  if (query.offset) q.offset = query.offset;
  return passportApi.enrollments({ id: enrollmentId }).journal.get({ query: q });
}

// PENDING (B2). A passport_tg_bindings row with user_id set and employee_id
// null — the mentor's telegram binding, without which a manager cannot enter
// the miniapp at all.
export interface PassportMentor {
  id: string;
  telegram_id: number;
  user_id: string | null;
  employee_id: string | null;
  first_name: string;
  lang: string; // "ru" | "uz"
  banned: boolean;
  created_at: string;
}

export interface PassportMentorCreateInput {
  user_id: string;
  telegram_id: number;
}

// PENDING (B2). Gated by the not-yet-seeded `passport.mentors.manage`.
export function listMentors(): EdenResult<
  PassportListResponse<PassportMentor>
> {
  return passportApi.mentors.get();
}

// PENDING (B2). 409 if that telegram_id is already bound to a TRAINEE
// (employee_id not null) — re-binding a trainee's account to a mentor is the
// defect class fixed in stage 1a.
export function createMentor(
  input: PassportMentorCreateInput
): EdenResult<PassportMentor> {
  return passportApi.mentors.post(input);
}

// PENDING (B2). telegram_id is a PATH param here, not a body field.
export function deleteMentor(
  telegramId: number | string
): EdenResult<{ deleted: boolean }> {
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

// The machine-readable `code` on a curriculum refusal (unpublish /
// deleteProgramModule): "module_in_use", "module_in_use_in_program",
// "not_published", "module_not_found", "link_not_found". Lets the UI offer the
// right next action ("deactivate instead") rather than echoing English prose.
export function refusalCode(error: any): string | null {
  const code = error?.value?.code;
  return typeof code === "string" ? code : null;
}
