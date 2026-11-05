// Права экранов KPI. Наборы повторяют права GET-роутов backend/src/modules/kpi.

export type KpiScreen = "reviews" | "violations" | "disputes" | "month" | "raises" | "settings" | "attendance" | "timesheet" | "people" | "workly" | "network" | "branch" | "revenue_plans" | "sanitary" | "staff";

export const KPI_SCREEN_PERMS: Record<KpiScreen, readonly string[]> = {
  // kpi.approve: HR разбирает споры и правит оценки закрытого месяца (hr_adjusted) — нужна форма и журнал.
  reviews: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  violations: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  disputes: ["kpi.evaluate", "kpi.view", "kpi.approve"],
  month: ["kpi.view", "kpi.approve", "kpi.manage"],
  raises: ["kpi.view", "kpi.approve"],
  settings: ["kpi.manage"],
  attendance: ["kpi.manage"],
  // Табель: права GET /kpi/attendance/board; видимость по филиалам решает сервер.
  timesheet: ["kpi.view", "kpi.manage", "kpi.approve"],
  // Сотрудники KPI и карточка: права GET /kpi/people и /kpi/employees/:id/profile, видимость решает сервер.
  people: ["kpi.evaluate", "kpi.view", "kpi.manage", "kpi.approve"],
  workly: ["kpi.manage"],
  network: ["kpi.view", "kpi.manage", "kpi.approve"],
  branch: ["kpi.view", "kpi.manage", "kpi.approve"],
  revenue_plans: ["kpi.manage"],
  sanitary: ["kpi.evaluate", "kpi.manage"],
  // Привязка Telegram своих сотрудников: те же права, что у списка сотрудников; кого именно, решает сервер.
  staff: ["kpi.evaluate", "kpi.view", "kpi.manage"],
};

export const KPI_SCREEN_TITLE: Record<KpiScreen, string> = {
  reviews: "Оценки",
  violations: "Нарушения",
  disputes: "Споры",
  month: "Месяц",
  raises: "Повышения",
  settings: "Настройки KPI",
  attendance: "Загрузка Workly",
  timesheet: "Посещаемость",
  people: "Сотрудники KPI",
  workly: "Синхронизация Workly",
  network: "Сеть",
  branch: "Филиал",
  revenue_plans: "План выручки",
  sanitary: "Санитарная проверка",
  staff: "Регистрация в Telegram",
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
