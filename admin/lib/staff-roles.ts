// Справочник ролей сотрудника — общий клиентский слой.
//
// Роуты /api/staff-roles живут на цепочке networkMapControllerImpl, а тот
// экспортирован как `as unknown as Elysia` (TS2589 — глубина инстанцирования
// в apiController уже на пределе). Из-за этого Eden не выводит их типы из
// `treaty<App>()`: эндпоинты настоящие, просто невидимые для типов — ровно
// та же ситуация, что описана в lib/passport-api.ts и lib/credit-api.ts.
// Здесь один `as any` на весь фронт справочника вместо каста в каждом вызове.
//
// Тела POST/PUT объявлены как `t.Object({ data: t.Object({...}) })`, поэтому
// вызовы идут `.post({ data })` — как в credit-api, НЕ как в passport-api.

import { apiClient } from "@admin/utils/eden";
import { useQuery } from "@tanstack/react-query";

const rolesApi = (apiClient.api as any)["staff-roles"];

export type StaffRoleGroup = "kitchen" | "front" | "management" | "other";

export interface StaffRole {
  id: string;
  code: string;
  name_ru: string;
  name_uz: string;
  group_key: string;
  is_trainee: boolean;
  trainee_of_code: string | null;
  sort: number;
  active: boolean;
  employees_count?: number;
}

export interface StaffRoleInput {
  code?: string;
  name_ru: string;
  name_uz: string;
  group_key: string;
  is_trainee?: boolean;
  trainee_of_code?: string | null;
  sort?: number;
  active?: boolean;
}

/** Eden не бросает на 4xx — он возвращает `{ data, error }`. Без этой проверки
 *  react-query считает 409/422 успехом и показывает «сохранено» на ошибке. */
export function unwrapEden(res: any) {
  if (res?.error) {
    const v = res.error.value ?? res.error;
    throw new Error(
      typeof v === "string" ? v : v?.message ?? `HTTP ${res.error.status ?? ""}`
    );
  }
  return res?.data;
}

export const staffRolesApi = {
  list: async (query: Record<string, string> = {}) =>
    unwrapEden(await rolesApi.get({ query })),
  one: async (id: string) => unwrapEden(await rolesApi({ id }).get({})),
  create: async (data: StaffRoleInput) =>
    unwrapEden(await rolesApi.post({ data })),
  update: async (id: string, data: Partial<StaffRoleInput>) =>
    unwrapEden(await rolesApi({ id }).put({ data })),
  /** DELETE — это деактивация, а не удаление. Ответ несёт employees_kept. */
  deactivate: async (id: string) => unwrapEden(await rolesApi({ id }).delete({})),
};

export const STAFF_ROLE_GROUPS: StaffRoleGroup[] = [
  "kitchen",
  "front",
  "management",
  "other",
];

/** Сентинел для «не указано» в Select: SelectItem не принимает пустой value. */
export const NONE = "__none__";
/** Сентинел «все» в фильтрах — тот же приём, что уже в data-table сотрудников. */
export const ALL = "__all__";

/**
 * Что показывать пользователю. Узбекская латиница берёт name_uz, остальные
 * локали — name_ru: узбекской кириллицы в справочнике нет, а английских
 * названий нет вовсе, и подставлять туда латиницу было бы враньём.
 */
export function roleLabel(role: StaffRole | undefined, locale: string): string {
  if (!role) return "";
  return locale === "uz-Latn" && role.name_uz ? role.name_uz : role.name_ru;
}

/**
 * Клиентская копия backend composePosition: «Роль[ N разряд][ смена]».
 *
 * Собирается ВСЕГДА из name_ru, даже когда список показан по-узбекски — это
 * предпросмотр той самой строки, которую сервер положит в employees.position,
 * а он знает только русское название.
 */
export function composePositionPreview(
  role: StaffRole | undefined,
  grade: number | null,
  shift: string | null
): string {
  if (!role) return "";
  const parts = [role.name_ru.trim()];
  if (grade != null) parts.push(`${grade} разряд`);
  if (shift === "day") parts.push("день");
  if (shift === "night") parts.push("ночь");
  return parts.join(" ");
}

/** Роли, сгруппированные по group_key, в порядке sort (его задаёт сервер). */
export function groupRoles(
  roles: StaffRole[]
): { group: string; roles: StaffRole[] }[] {
  const out: { group: string; roles: StaffRole[] }[] = [];
  for (const g of STAFF_ROLE_GROUPS) {
    const inGroup = roles.filter((r) => r.group_key === g);
    if (inGroup.length) out.push({ group: g, roles: inGroup });
  }
  // Группа, которой нет в списке известных (её мог завести HR) — не теряем.
  const known = new Set<string>(STAFF_ROLE_GROUPS);
  const rest = roles.filter((r) => !known.has(r.group_key));
  for (const r of rest) {
    const bucket = out.find((o) => o.group === r.group_key);
    if (bucket) bucket.roles.push(r);
    else out.push({ group: r.group_key, roles: [r] });
  }
  return out;
}

/** Список ролей. По умолчанию только активные — в выпадающих списках форм. */
export function useStaffRoles(opts: { activeOnly?: boolean } = {}) {
  const activeOnly = opts.activeOnly ?? true;
  return useQuery({
    queryKey: ["staff_roles", { active: activeOnly ? "true" : "" }],
    queryFn: async () => {
      const res = await staffRolesApi.list(activeOnly ? { active: "true" } : {});
      return (res?.data ?? []) as StaffRole[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
