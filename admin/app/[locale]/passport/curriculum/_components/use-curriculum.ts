"use client";

// Query keys, unwrapping and the permission facts the builder gates its
// buttons on. Everything server-state goes through here so the six lifecycle
// actions and the tree share one cache.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  listModules,
  listPrograms,
  listTopics,
  type PassportListResponse,
  type PassportModule,
  type PassportProgram,
  type PassportTopic,
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
 * TanStack Query needs a throw to register a failure, but Eden hands failures
 * back as a plain `{data:null, error}` tuple. Rethrow with `status`/`value`
 * kept, because the whole screen is built on reading them (422 publish list,
 * 409 refusal codes, 403 department scope).
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
// query keys — exported so mutations elsewhere invalidate the same strings
// ---------------------------------------------------------------------------

export const qk = {
  perms: ["my_permissions"] as const,
  me: ["currentUser"] as const,
  programs: ["passport_programs"] as const,
  modules: (programId: string | null, includeInactive: boolean) =>
    ["passport_modules", programId ?? "__all__", includeInactive] as const,
  topics: (moduleId: string) => ["passport_topics", moduleId] as const,
  tests: ["attestation_tests_picker"] as const,
};

// ---------------------------------------------------------------------------
// permissions & department scope
// ---------------------------------------------------------------------------

export interface CurriculumAccess {
  ready: boolean;
  /** passport.curriculum.edit — modules, topics, submit-review, new-version. */
  canEdit: boolean;
  /**
   * passport.curriculum.publish — publish/unpublish/deactivate/activate,
   * programme CRUD and programme↔module links. Holding it ALSO makes the
   * backend treat you as a curriculum admin (isCurriculumAdmin,
   * controller.ts:49-61), i.e. cross-department reach.
   */
  canPublish: boolean;
  /** users.department of the signed-in user; the scope the backend confines
   *  a non-admin editor to (controller.ts:455-459, fails closed when empty). */
  department: string | null;
}

export function useCurriculumAccess(): CurriculumAccess {
  const { data: permsData, isFetched: permsFetched } = useQuery({
    queryKey: qk.perms,
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const { data: meData, isFetched: meFetched } = useQuery({
    queryKey: qk.me,
    queryFn: async () => (await apiClient.api.users.me.get()).data,
    retry: false,
  });

  const perms: string[] = (permsData as any)?.permissions ?? [];
  const u = ((meData as any)?.user ?? meData) as any;

  return {
    ready: permsFetched && meFetched,
    canEdit: perms.includes("passport.curriculum.edit"),
    canPublish: perms.includes("passport.curriculum.publish"),
    department: (u?.department as string) ?? null,
  };
}

/**
 * Whether a given module is writable by this user *as far as the UI can tell*.
 * A published module is frozen (every write 409s) and a foreign department is
 * 403 unless the caller is a curriculum admin. Both are checked so the editor
 * never offers a button whose only outcome is an error.
 */
export function moduleIsWritable(
  mod: PassportModule,
  access: CurriculumAccess
): boolean {
  if (!access.canEdit) return false;
  if (mod.status === "published") return false;
  if (!access.canPublish && mod.owner_department !== access.department)
    return false;
  return true;
}

/** Same, ignoring the published freeze — for "may I even see the editor". */
export function moduleInScope(
  mod: PassportModule,
  access: CurriculumAccess
): boolean {
  return access.canPublish || mod.owner_department === access.department;
}

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

/**
 * GET /passport/programs is gated on `passport.matrix.view`, NOT on
 * curriculum.*. An editor who holds only passport.curriculum.edit therefore
 * gets a 403 on this screen's entry point — the caller degrades to the
 * unfiltered module list instead of showing an empty page.
 */
export function usePrograms() {
  return useQuery<PassportListResponse<PassportProgram>, ApiError>({
    queryKey: qk.programs,
    queryFn: () => unwrap(listPrograms()),
    retry: false,
  });
}

export function useModules(
  programId: string | null,
  includeInactive: boolean,
  enabled = true
) {
  return useQuery<PassportListResponse<PassportModule>, ApiError>({
    queryKey: qk.modules(programId, includeInactive),
    queryFn: () =>
      unwrap(
        listModules({
          ...(programId ? { program_id: programId } : {}),
          // Exact string "true" — the backend compares against the literal.
          ...(includeInactive ? { include_inactive: "true" as const } : {}),
        })
      ),
    enabled,
  });
}

export function useTopics(moduleId: string | null) {
  return useQuery<PassportListResponse<PassportTopic>, ApiError>({
    queryKey: qk.topics(moduleId ?? "none"),
    queryFn: () => unwrap(listTopics(moduleId as string)),
    enabled: !!moduleId,
  });
}

export interface TestOption {
  id: string;
  title: string;
}

/**
 * Quiz picker source. `GET /attestation/tests` is gated on `tests.list`, which
 * a curriculum editor may well not hold — on failure the topic form falls back
 * to a raw uuid input rather than making quiz topics unpublishable.
 */
export function useTestOptions() {
  return useQuery<TestOption[], Error>({
    queryKey: qk.tests,
    queryFn: async () => {
      const { data, error } = await apiClient.api.attestation.tests.get({
        query: { limit: "200", offset: "0", fields: "id,title" },
      });
      if (error) throw new Error(apiMessage(error));
      return ((data as any)?.data ?? []) as TestOption[];
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
