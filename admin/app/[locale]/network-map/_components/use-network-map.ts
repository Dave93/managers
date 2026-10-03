"use client";

// Данные карты сети.
//
// Один запрос — GET /api/terminals/network-map. Ничего не пересчитывается на
// клиенте: разбор строки должности («Повар 1 разряд ночь») живёт на бэкенде и
// только там, потому что опечатки в справочнике («раяряд») правятся в одном
// месте, а не в четырёх компонентах.
//
// Скоуп по филиалам делает эндпоинт. Не-HQ видит свои филиалы, пустой скоуп
// отдаёт пустой ответ с network: null — экран обязан отличать это от ошибки
// сети, поэтому ниже есть отдельное состояние, а не общий «нет данных».
//
// Роутов паспорта в Eden-типах нет по известной причине (лимит глубины
// инстанцирования, см. admin/lib/passport-api.ts); тут та же страховка —
// один каст в одном месте, а не `any` по всем вызовам.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

export type Brand = "les" | "chopar" | "other";
export type GroupKey = "kitchen" | "front" | "management" | "other";
export type ShiftKey = "day" | "night" | "unknown";

export interface BranchStaff {
  total: number;
  trainees: number;
  groups: Record<GroupKey, number>;
  shifts: Record<ShiftKey, number>;
  /** Ключи «1» | «2» | «3» | «—»; «—» это «разряд в должности не указан». */
  grades: Record<string, number>;
  roles: { role: string; n: number }[];
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  manager_name: string | null;
  brand: Brand;
  brand_name: string | null;
  playground: boolean;
  lat: number | null;
  lon: number | null;
  has_coords: boolean;
  /**
   * ГЛАВНОЕ различие всего экрана. false — в справочнике сотрудников нет ни
   * одной строки по этому филиалу; это «данные не заведены», а не «людей нет».
   * Филиал с has_staff_data=true и total=0 — совсем другой факт, и выглядеть
   * он обязан иначе.
   */
  has_staff_data: boolean;
  staff: BranchStaff;
}

export interface NetworkTotals {
  branches_total: number;
  branches_with_staff_data: number;
  branches_without_staff_data: number;
  branches_on_map: number;
  staff_total: number;
  trainees_total: number;
  shifts: Record<ShiftKey, number>;
  groups: Record<GroupKey, number>;
  by_brand: { brand: string; branches: number; staff: number }[];
}

export interface NetworkMapResponse {
  network: NetworkTotals | null;
  branches: Branch[];
  scope: { is_hq: boolean; terminal_count: number };
}

export interface ApiError extends Error {
  status?: number;
}

function apiMessage(error: any): string {
  const v = error?.value ?? error;
  if (typeof v?.message === "string") return v.message;
  if (typeof error?.message === "string") return error.message;
  return "Не удалось загрузить карту сети";
}

async function unwrap<T>(
  call: Promise<{ data: T | null; error: any }>
): Promise<T> {
  const { data, error } = await call;
  if (error) {
    const e = new Error(apiMessage(error)) as ApiError;
    e.status = error?.status;
    throw e;
  }
  return data as T;
}

export function useNetworkMap() {
  return useQuery<NetworkMapResponse, ApiError>({
    queryKey: ["terminals_network_map"],
    queryFn: () =>
      unwrap<NetworkMapResponse>(
        (apiClient.api as any).terminals["network-map"].get()
      ),
    // Отказ по правам — штатное, объяснимое состояние этого экрана, а не сбой:
    // три молчаливых ретрая только оттянули бы понятное сообщение.
    retry: false,
    staleTime: 60_000,
  });
}

export function useNetworkMapAccess() {
  const { data, isFetched } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return { ready: isFetched, canView: perms.includes("employees.list") };
}
