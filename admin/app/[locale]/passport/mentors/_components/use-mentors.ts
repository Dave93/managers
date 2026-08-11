"use client";

// Server state for the mentor-bindings screen. Per-section, like
// use-enrollments.ts and use-curriculum.ts next door: this page must be able to
// change its data layer without dragging a sibling screen down with it.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  listMentors,
  type PassportListResponse,
  type PassportMentorListQuery,
  type PassportMentorRow,
} from "@admin/lib/passport-api";

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

export const qk = {
  perms: ["my_permissions"] as const,
  mentors: (q: PassportMentorListQuery) => ["passport_mentors", q] as const,
  /** Every page — what a bind/unbind invalidates. */
  mentorsAll: ["passport_mentors"] as const,
  officeUsers: ["passport_office_users"] as const,
};

export interface MentorsAccess {
  ready: boolean;
  /** passport.mentors.manage — the list AND both write routes. */
  canManage: boolean;
  /** users.list — a SEPARATE permission, and the office-user picker needs it. */
  canListUsers: boolean;
}

export function useMentorsAccess(): MentorsAccess {
  const { data, isFetched } = useQuery({
    queryKey: qk.perms,
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return {
    ready: isFetched,
    canManage: perms.includes("passport.mentors.manage"),
    canListUsers: perms.includes("users.list"),
  };
}

export function useMentors(query: PassportMentorListQuery, enabled = true) {
  return useQuery<PassportListResponse<PassportMentorRow>, ApiError>({
    queryKey: qk.mentors(query),
    queryFn: () => unwrap(listMentors(query)),
    enabled,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export interface OfficeUser {
  id: string;
  login: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
}

/**
 * The office accounts a binding can point at.
 *
 * Fetched in ONE page rather than searched server-side: GET /users takes
 * `filters` as an AND-list (backend/src/lib/parseFilterFields.ts), so there is
 * no way to express "login OR first_name OR last_name contains X" — and this
 * table is small (tens of rows, not thousands), so the whole active roster
 * arrives at once and the picker filters it in the browser. `password`/`salt`
 * are dropped server-side; `fields` narrows the payload further.
 *
 * Gated on `users.list`, which is NOT bundled with passport.mentors.manage by
 * any seed — hence `retry:false` and a caller that explains the 403 instead of
 * showing an empty dropdown.
 */
export function useOfficeUsers(enabled: boolean) {
  return useQuery<OfficeUser[], ApiError>({
    queryKey: qk.officeUsers,
    queryFn: async () => {
      const { data, error } = await apiClient.api.users.get({
        query: {
          limit: "500",
          offset: "0",
          fields: "id,login,status,first_name,last_name",
          // No `filters`: parseFilterFields THROWS on a shape it dislikes
          // (backend/src/lib/parseFilterFields.ts), and the whole roster is
          // active anyway — a status filter would buy nothing and add a
          // failure mode. Non-active accounts, if any ever appear, are
          // flagged in the table instead of being hidden here.
        },
      });
      if (error) {
        const e = new Error(apiMessage(error)) as ApiError;
        e.status = (error as any)?.status;
        e.value = (error as any)?.value;
        throw e;
      }
      const rows = ((data as any)?.data ?? []) as OfficeUser[];
      return [...rows].sort((a, b) =>
        userLabel(a).localeCompare(userLabel(b), "ru")
      );
    },
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/** The users table's status enum, in the language the page is written in. */
export const USER_STATUS_LABEL: Record<string, string> = {
  active: "активна",
  blocked: "заблокирована",
  inactive: "отключена",
};

export function userStatusLabel(status: string | null | undefined): string {
  if (!status) return "неизвестно";
  return USER_STATUS_LABEL[status] ?? status;
}

/** first+last, falling back to login — the same rule the list route applies
 *  server-side when it computes `user.name`. */
export function userLabel(u: {
  first_name?: string | null;
  last_name?: string | null;
  login?: string | null;
}): string {
  const s = [u.last_name, u.first_name].filter(Boolean).join(" ").trim();
  return s.length ? s : (u.login ?? "без имени");
}

/**
 * Postgres `timestamptz` reaches us through drizzle (mode:"string") as
 * "2026-08-09 17:00:00+05", which is NOT ISO-8601.
 */
export function parseTimestamp(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  return Date.parse(value.replace(" ", "T"));
}

const DATE_FMT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function fmtDate(value: string | null | undefined): string {
  const ms = parseTimestamp(value);
  return Number.isNaN(ms) ? "—" : DATE_FMT.format(ms);
}
