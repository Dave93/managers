// Чистая часть разового скрипта роли «Техничка»: решает, кому проставить роль и кого показать человеку.
// Без базы и env, чтобы проверяться тестом.

export type CleanerRow = { id: string; position: string | null; staff_role_id: string | null };
export type RoleRow = { id: string; code: string; name_ru: string };

const CLEANER = /техничк/i;
const TRAINEE = /стажер|стажёр/i;

export type CleanerPlan = {
  /** Без роли, должность содержит «техничк», не стажёр: им проставляем cleaner. */
  assign: string[];
  /** Роль уже стоит другая (или это стажёр): не меняем, показываем на просмотр. */
  review: { id: string; position: string | null; staff_role_id: string | null }[];
};

// cleanerRoleId — id роли cleaner, если она уже есть (до вставки null).
export function planCleaners(rows: CleanerRow[], cleanerRoleId: string | null): CleanerPlan {
  const plan: CleanerPlan = { assign: [], review: [] };
  for (const r of rows) {
    if (r.position == null || !CLEANER.test(r.position)) continue;
    if (r.staff_role_id != null && r.staff_role_id === cleanerRoleId) continue; // уже сделано
    if (r.staff_role_id == null && !TRAINEE.test(r.position)) plan.assign.push(r.id);
    else plan.review.push({ id: r.id, position: r.position, staff_role_id: r.staff_role_id });
  }
  return plan;
}

// Роль «Техничка», заведённая вручную под другим кодом: вторую такую вставлять нельзя.
export function foreignCleanerRole(roles: RoleRow[]): RoleRow | null {
  return roles.find((r) => r.code !== "cleaner" && r.name_ru.trim().toLowerCase() === "техничка") ?? null;
}
