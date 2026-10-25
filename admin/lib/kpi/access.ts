// Права экранов KPI. Наборы повторяют права GET-роутов backend/src/modules/kpi.

export type KpiScreen = "reviews" | "violations" | "disputes" | "month" | "raises" | "settings";

export const KPI_SCREEN_PERMS: Record<KpiScreen, readonly string[]> = {
  // kpi.approve: HR разбирает споры и правит оценки закрытого месяца (hr_adjusted) — нужна форма и журнал.
  reviews: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  violations: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  disputes: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  month: ["kpi.view", "kpi.approve", "kpi.manage"],
  raises: ["kpi.view", "kpi.approve"],
  settings: ["kpi.manage"],
};

export const KPI_SCREEN_TITLE: Record<KpiScreen, string> = {
  reviews: "Оценки",
  violations: "Нарушения",
  disputes: "Споры",
  month: "Месяц",
  raises: "Повышения",
  settings: "Настройки KPI",
};

export function canOpen(perms: readonly string[] | undefined, screen: KpiScreen): boolean {
  if (!perms || !perms.includes("kpi_layout")) return false;
  return KPI_SCREEN_PERMS[screen].some((p) => perms.includes(p));
}

export type KpiAccess = { evaluate: boolean; view: boolean; manage: boolean; approve: boolean };

export function kpiAccess(perms: readonly string[] | undefined): KpiAccess {
  const has = (p: string) => !!perms && perms.includes(p);
  return { evaluate: has("kpi.evaluate"), view: has("kpi.view"), manage: has("kpi.manage"), approve: has("kpi.approve") };
}
