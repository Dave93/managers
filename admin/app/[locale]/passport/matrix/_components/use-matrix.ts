"use client";

// Server state for the progress matrix: query keys, Eden error unwrapping,
// the reference lists (programmes, terminals) and the date maths.
//
// A per-section file on purpose — the same way enrollments/_components owns
// use-enrollments.ts and curriculum/_components owns use-curriculum.ts. The
// three deliberately do not import from each other: a screen must be able to
// change its own data layer without a sibling screen going down with it.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  getJournal,
  getMatrix,
  listPrograms,
  type PassportJournalResponse,
  type PassportListResponse,
  type PassportMatrixQuery,
  type PassportMatrixResponse,
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
 * throw. `status` is carried across because this screen reads it: 403 is a
 * routine, explainable state here (the matrix is gated on
 * `passport.matrix.view`, which not every passport role holds).
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
// query keys
// ---------------------------------------------------------------------------

export const qk = {
  perms: ["my_permissions"] as const,
  programs: ["passport_programs"] as const,
  terminals: ["terminals_cached"] as const,
  matrix: (q: PassportMatrixQuery) => ["passport_matrix", q] as const,
  journal: (id: string, limit: number) =>
    ["passport_journal", id, limit] as const,
};

// ---------------------------------------------------------------------------
// permissions
// ---------------------------------------------------------------------------

export interface MatrixAccess {
  ready: boolean;
  /** passport.matrix.view — the grid, the programme list AND the journal. */
  canViewMatrix: boolean;
}

export function useMatrixAccess(): MatrixAccess {
  const { data, isFetched } = useQuery({
    queryKey: qk.perms,
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return { ready: isFetched, canViewMatrix: perms.includes("passport.matrix.view") };
}

// ---------------------------------------------------------------------------
// brands
//
// `row.brand` is the CODE of the organization owning the trainee's terminal
// (organization.code — verified against the database: exactly two rows,
// "chopar" and "les"). The code is what the API filter takes; the name is what
// a human reads. Both live here so the filter and the grid can never show two
// different words for the same brand.
// ---------------------------------------------------------------------------

export const BRANDS: { value: string; label: string }[] = [
  { value: "chopar", label: "ChoparPizza" },
  { value: "les", label: "Les Ailes" },
];

/** Falls back to the raw code: a third organization would be visible, not hidden. */
export function brandLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return BRANDS.find((b) => b.value === code)?.label ?? code;
}

// ---------------------------------------------------------------------------
// reference data
// ---------------------------------------------------------------------------

/**
 * GET /passport/programs shares this screen's permission
 * (`passport.matrix.view`), so on the matrix it is not the separate-403 risk it
 * is on the enrollments screen. `retry:false` all the same — a degraded filter
 * should appear at once, not after three silent retries.
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

// ---------------------------------------------------------------------------
// the grid itself
// ---------------------------------------------------------------------------

export function useMatrix(query: PassportMatrixQuery) {
  return useQuery<PassportMatrixResponse, ApiError>({
    queryKey: qk.matrix(query),
    queryFn: () => unwrap(getMatrix(query)),
    retry: false,
    // Keeps the previous grid on screen while a filter change is in flight, so
    // the screen never flashes back to a skeleton the user has already read.
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
// dates — same rules as the enrollments screen, restated locally
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

export function deadlineInfo(
  deadline: string | null,
  nowMs: number = Date.now()
): DeadlineInfo | null {
  const at = parseTimestamp(deadline);
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

export function plural(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return `${n} ${many}`;
  if (last > 1 && last < 5) return `${n} ${few}`;
  if (last === 1) return `${n} ${one}`;
  return `${n} ${many}`;
}
