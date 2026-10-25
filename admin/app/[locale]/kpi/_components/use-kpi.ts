"use client";

// Серверное состояние раздела KPI: ключи запросов, права, «я» и список филиалов.
// Ключи экспортируются, чтобы мутации сбрасывали ровно то, что читают экраны.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  kpiApi,
  type DisputesQuery,
  type EmployeesQuery,
  type MeResponse,
  type ViolationsQuery,
} from "@admin/lib/kpi-api";
import { kpiAccess, type KpiAccess } from "@admin/lib/kpi/access";
import type { KpiApiError } from "@admin/lib/kpi/errors";
import { shouldRetry } from "@admin/lib/kpi/errors";
import type { Option } from "@admin/lib/kpi/filters";

export const qk = {
  perms: ["my_permissions"] as const,
  me: ["kpi_me"] as const,
  // Свой ключ, а не общий ["terminals_cached"]: под ним разные экраны хранят разную форму данных.
  terminals: ["kpi_terminals"] as const,
  cards: (inactive: boolean) => ["kpi_cards", inactive] as const,
  /** Все варианты запроса карт — то, что сбрасывает правка карты или пункта. */
  cardsAll: ["kpi_cards"] as const,
  employees: (q: EmployeesQuery) => ["kpi_employees", q] as const,
  employeesAll: ["kpi_employees"] as const,
  form: (period: string, employeeId: string) => ["kpi_form", period, employeeId] as const,
  formAll: ["kpi_form"] as const,
  events: (reviewId: string) => ["kpi_events", reviewId] as const,
  violations: (q: ViolationsQuery) => ["kpi_violations", q] as const,
  violationsAll: ["kpi_violations"] as const,
  disputes: (q: DisputesQuery) => ["kpi_disputes", q] as const,
  disputesAll: ["kpi_disputes"] as const,
  period: (p: string) => ["kpi_period", p] as const,
  raises: (q: string) => ["kpi_raises", q] as const,
  raisesAll: ["kpi_raises"] as const,
  tiers: ["kpi_tiers"] as const,
  settings: ["kpi_settings"] as const,
  evaluators: ["kpi_evaluators"] as const,
  users: (search: string) => ["kpi_users", search] as const,
};

/** Права текущего пользователя. Тот же ключ и queryFn, что у useMyPermissions: один кэш. */
export function useKpiPerms(): { ready: boolean; perms: string[]; access: KpiAccess } {
  const { data, isFetched } = useQuery({
    queryKey: qk.perms,
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return { ready: isFetched, perms, access: kpiAccess(perms) };
}

export function useKpiMe(): UseQueryResult<MeResponse, KpiApiError> {
  return useQuery<MeResponse, KpiApiError>({
    queryKey: qk.me,
    queryFn: () => kpiApi.me(),
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useKpiTerminals(): UseQueryResult<Option[], Error> {
  return useQuery<Option[], Error>({
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
