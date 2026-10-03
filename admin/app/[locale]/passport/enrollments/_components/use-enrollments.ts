"use client";

// Server state for the enrollments screen: query keys, Eden error unwrapping,
// the reference lists (programmes, terminals, employees) and the deadline
// maths. Kept as a per-section file, the same way each list route owns its own
// data-table.tsx — the curriculum builder has its own use-curriculum.ts and
// the two deliberately do not import from each other's _components.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  listEnrollments,
  listPrograms,
  getJournal,
  type PassportEnrollmentListQuery,
  type PassportEnrollmentRow,
  type PassportJournalResponse,
  type PassportListResponse,
  type PassportProgram,
} from "@admin/lib/passport-api";

// ---------------------------------------------------------------------------
// error unwrapping
// ---------------------------------------------------------------------------

export interface ApiError extends Error {
  status?: number;
  value?: any;
}

export function apiMessage(error: any): string {
  const v = error?.value ?? error;
  if (typeof v?.message === "string") return v.message;
  if (typeof error?.message === "string") return error.message;
  return "Не удалось выполнить запрос";
}

/**
 * Eden hands failures back as `{data:null, error}`; TanStack Query needs a
 * throw. `status` and `value` are carried across because this screen is built
 * on reading them — the 409 conflict body, the 403 scope refusals.
 */
export async function unwrap<T>(
  call: Promise<{ data: T | null; error: any }>
): Promise<T> {
  const { data, error } = await call;
  if (error) {
    const e = new Error(apiMessage(error)) as ApiError;
    e.status = error?.status;
    e.value = error?.value;
    throw e;
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// query keys — exported so the mutations invalidate exactly what the table reads
// ---------------------------------------------------------------------------

export const qk = {
  perms: ["my_permissions"] as const,
  programs: ["passport_programs"] as const,
  terminals: ["terminals_cached"] as const,
  enrollments: (q: PassportEnrollmentListQuery) =>
    ["passport_enrollments", q] as const,
  /** Every page of every filter combination — what a create/close/reinvite invalidates. */
  enrollmentsAll: ["passport_enrollments"] as const,
  employees: (search: string) => ["passport_employee_picker", search] as const,
  journal: (id: string, limit: number) =>
    ["passport_journal", id, limit] as const,
};

// ---------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------

export interface EnrollmentsAccess {
  ready: boolean;
  /** passport.enrollments.manage — create, close, reinvite. */
  canManage: boolean;
  /** passport.matrix.view — gates GET /passport/programs AND the journal. */
  canViewMatrix: boolean;
}

export function useEnrollmentsAccess(): EnrollmentsAccess {
  const { data, isFetched } = useQuery({
    queryKey: qk.perms,
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return {
    ready: isFetched,
    canManage: perms.includes("passport.enrollments.manage"),
    canViewMatrix: perms.includes("passport.matrix.view"),
  };
}

// ---------------------------------------------------------------------------
// reference data
// ---------------------------------------------------------------------------

/**
 * GET /passport/programs is gated on `passport.matrix.view`, not on
 * enrollments.manage — an HR user who can start enrollments may still get 403
 * here. `retry:false` so the degraded state appears immediately instead of
 * after three silent retries; callers hide the programme filter and explain it
 * in the create form rather than showing an empty <Select>.
 */
export function usePrograms() {
  return useQuery<PassportListResponse<PassportProgram>, ApiError>({
    queryKey: qk.programs,
    queryFn: () => unwrap(listPrograms()),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export interface TerminalOption {
  id: string;
  name: string;
}

/**
 * Enrollment rows carry `terminal_id` and nothing else, so a branch name needs
 * this map. Same source the attestation employees table uses
 * (app/[locale]/attestation/employees/data-table.tsx).
 */
export function useTerminals() {
  return useQuery<TerminalOption[], Error>({
    queryKey: qk.terminals,
    queryFn: async () => {
      const res: any = await apiClient.api.terminals.cached.get();
      const rows = (res?.data?.data ?? res?.data ?? []) as any[];
      return rows
        .map((t) => ({ id: String(t.id), name: String(t.name ?? t.id) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    },
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}

export function useTerminalNames(): (id: string | null) => string {
  const { data } = useTerminals();
  return (id) => {
    if (!id) return "—";
    // A name is missing either because the registry could not be read (a role
    // without `terminals.list` gets 403 and this list stays empty) or because
    // the id is not in it (deleted / renamed terminal). Neither is worth a
    // uuid in a column a human reads: both list screens take the branch NAME
    // straight from the server instead (terminal_name on GET
    // /passport/enrollments and GET /passport/matrix), so neither depends on
    // `terminals.list` to stay readable. This stays as the last-resort label
    // for the few places that only ever have an id.
    const hit = (data ?? []).find((t) => t.id === id);
    return hit?.name ?? `${id.slice(0, 8)}…`;
  };
}

export interface EmployeeOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  terminal_id: string;
  active: boolean;
}

/**
 * The registry behind the employee picker. GET /attestation/employees is gated
 * on `employees.list` — a separate permission from passport.enrollments.manage,
 * and the seeds never bundle the two, so an HR account can legitimately hold
 * one without the other. On 403 the picker says so instead of looking empty:
 * there is no useful fallback (a uuid box is not something HR can fill in).
 */
export function useEmployeeSearch(search: string, enabled: boolean) {
  return useQuery<EmployeeOption[], ApiError>({
    queryKey: qk.employees(search),
    queryFn: async () => {
      const { data, error } = await apiClient.api.attestation.employees.get({
        query: {
          limit: "30",
          offset: "0",
          active: "true",
          ...(search ? { search } : {}),
        },
      });
      if (error) {
        const e = new Error(apiMessage(error)) as ApiError;
        e.status = (error as any)?.status;
        e.value = (error as any)?.value;
        throw e;
      }
      return ((data as any)?.data ?? []) as EmployeeOption[];
    },
    enabled,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// the list itself
// ---------------------------------------------------------------------------

export function useEnrollments(query: PassportEnrollmentListQuery) {
  return useQuery<PassportListResponse<PassportEnrollmentRow>, ApiError>({
    queryKey: qk.enrollments(query),
    queryFn: () => unwrap(listEnrollments(query)),
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useJournal(enrollmentId: string | null, limit: number) {
  return useQuery<PassportJournalResponse, ApiError>({
    queryKey: qk.journal(enrollmentId ?? "none", limit),
    queryFn: () =>
      unwrap(getJournal(enrollmentId as string, { limit: String(limit) })),
    enabled: !!enrollmentId,
    retry: false,
    // NOT `(prev) => prev`. In TanStack v5 placeholderData is carried ACROSS
    // query-key changes, and this key changes every time the user opens the
    // journal of a DIFFERENT enrollment — the routine interaction here. The
    // previous trainee's sign-offs would render under the new trainee's name
    // with no loading state at all (`isLoading` is false while placeholder data
    // exists), and any module-level focus makes it worse rather than better:
    // filtering the stale rows by module id keeps exactly the ones that look
    // topically plausible. This is an audit surface — "кто что подтвердил" must
    // never show another person's evidence, not even for one frame.
    //
    // The placeholder survives only when the enrollment is unchanged and just
    // `limit` grew ("показать ещё"), which is the case it was added for.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === (enrollmentId ?? "none") ? prev : undefined,
  });
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

/**
 * Postgres `timestamptz` reaches us through drizzle (mode:"string") as
 * "2026-08-09 17:00:00+05", which is NOT ISO-8601. V8 parses it today; the
 * backend hedged against that stopping (deadline.ts:16-21) and so does this.
 */
export function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  return Date.parse(value.replace(" ", "T"));
}

/** Same 3-day threshold the trainee's own feed uses (deadline.ts:11). */
export const DEADLINE_WARNING_MS = 3 * 86400_000;

export type DeadlineTone = "ok" | "warning" | "overdue";

export interface DeadlineInfo {
  at: number;
  tone: DeadlineTone;
  /** Whole days remaining; negative once the deadline has passed. */
  days: number;
}

/**
 * The row carries an absolute `probation_deadline`, not the
 * (started_at, deadline_days) pair the backend's deadlineStatus() takes — so
 * this compares directly rather than pretending to reuse that signature. The
 * thresholds are the same, which is the part that has to agree.
 */
export function deadlineInfo(
  probationDeadline: string | null,
  nowMs: number = Date.now()
): DeadlineInfo | null {
  const at = parseTimestamp(probationDeadline);
  if (Number.isNaN(at)) return null;
  const left = at - nowMs;
  const tone: DeadlineTone =
    left < 0 ? "overdue" : left <= DEADLINE_WARNING_MS ? "warning" : "ok";
  return { at, tone, days: Math.ceil(left / 86400_000) };
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const LONG_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(value: string | null | undefined): string {
  const ms = parseTimestamp(value);
  return Number.isNaN(ms) ? "—" : DATE_FMT.format(ms);
}

export function fmtLongDate(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseTimestamp(value);
  return Number.isNaN(ms) ? "—" : LONG_FMT.format(ms);
}

export function fmtTime(value: string | null | undefined): string {
  const ms = parseTimestamp(value);
  return Number.isNaN(ms) ? "—" : TIME_FMT.format(ms);
}

/** "Пётр Иванов" from the row's nullable join columns. */
export function fullName(
  first: string | null | undefined,
  last: string | null | undefined
): string {
  const s = [last, first].filter(Boolean).join(" ").trim();
  return s.length ? s : "Без имени";
}
