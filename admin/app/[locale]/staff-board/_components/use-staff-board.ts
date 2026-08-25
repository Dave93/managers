"use client";

// Данные экрана «Состав филиалов».
//
// Один запрос — GET /api/terminals/staff-board. Разбор должности («Повар 1
// разряд ночь»), приведение имён из капса, сигналы по составу — всё считает
// бэкенд и только он: опечатка «раяряд» в справочнике правится в одном месте,
// а не в четырёх компонентах. Клиент здесь фильтрует и раскладывает, но ничего
// не выводит заново.
//
// Скоуп по филиалам делает эндпоинт. Не-HQ видит свои филиалы, роль без
// назначенных филиалов получает network: null — это отдельное объяснимое
// состояние, а не ошибка сети, и экран обязан их различать.
//
// Роутов вне apiController нет в Eden-типах (тот же лимит глубины
// инстанцирования, из-за которого контроллер зарегистрирован на корне app.ts) —
// поэтому один каст в одном месте, а не `any` по всем вызовам.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

export type Brand = "les" | "chopar" | "other";
export type GroupKey = "kitchen" | "front" | "management" | "other";
export type ShiftKey = "day" | "night" | "unknown";
export type SignalKey =
  | "no_manager"
  | "no_senior_cook"
  | "no_night"
  | "trainee_heavy"
  | "no_pin";

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  /** Уже приведено из капса на бэкенде: ZULAYHO AHMADJONOVA → Zulayho Ahmadjonova. */
  name: string;
  initials: string;
  /** Сырая строка должности из справочника — показывается как подсказка. */
  position: string | null;
  role: string;
  group: GroupKey;
  shift: ShiftKey;
  /** «1» | «2» | «3», либо null — разряда в должности нет. */
  grade: string | null;
  is_trainee: boolean;
  has_pin: boolean;
}

export interface BranchSignal {
  key: SignalKey;
  label: string;
  detail: string;
  severity: "warn" | "info";
}

export interface BranchStaff {
  total: number;
  trainees: number;
  pin_set: number;
  pin_missing: number;
  groups: Record<GroupKey, number>;
  shifts: Record<ShiftKey, number>;
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
  /**
   * ГЛАВНОЕ различие экрана. false — в справочнике сотрудников нет ни одной
   * строки по этому филиалу: «данные не заведены», а не «людей нет». На таком
   * филиале не заводится стажировка, значит паспорт стажёра там не работает.
   */
  has_staff_data: boolean;
  staff: BranchStaff;
  signals: BranchSignal[];
  people: Person[];
}

export interface NetworkTotals {
  branches_total: number;
  branches_with_staff_data: number;
  branches_without_staff_data: number;
  staff_total: number;
  trainees_total: number;
  pin_set_total: number;
  pin_missing_total: number;
  shifts: Record<ShiftKey, number>;
  groups: Record<GroupKey, number>;
  by_brand: { brand: string; branches: number; staff: number }[];
  signals: Record<SignalKey, number> & { branches_with_warnings: number };
}

export interface StaffBoardResponse {
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
  return "Не удалось загрузить состав филиалов";
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

export function useStaffBoard() {
  return useQuery<StaffBoardResponse, ApiError>({
    queryKey: ["terminals_staff_board"],
    queryFn: () =>
      unwrap<StaffBoardResponse>(
        (apiClient.api as any).terminals["staff-board"].get()
      ),
    // Отказ по правам — штатное, объяснимое состояние этого экрана, а не сбой:
    // молчаливые ретраи только оттянули бы понятное сообщение.
    retry: false,
    staleTime: 60_000,
  });
}

// Смотреть состав можно по employees.list, заводить человека — только по
// employees.edit. Кнопка, которая упрётся в 403, хуже отсутствующей кнопки,
// поэтому право спрашивается тем же запросом, что и гейт раздела: ["my_permissions"]
// уже прогрет layout'ом, лишнего похода на бэкенд здесь нет. До ответа
// возвращаем false — иначе кнопка успела бы мигнуть у того, кому не положена.
export function useCanEditEmployees(): boolean {
  const { data, isFetched } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => (await apiClient.api.users.my_permissions.get()).data,
  });
  const perms: string[] = (data as any)?.permissions ?? [];
  return isFetched && perms.includes("employees.edit");
}
