// Статусы и подписи KPI. Подписи — строго по спеке экранов, тон — цвет бейджа.
import type { EmployeeRow, ItemSource } from "@admin/lib/kpi-api";

export type Tone = "gray" | "amber" | "green" | "red" | "blue";
export type RowStatus = "none" | "draft" | "submitted" | "disputed";

/** Открытый спор важнее статуса оценки: строку с ним HR должен заметить первой. */
export function rowStatus(r: Pick<EmployeeRow, "review" | "open_dispute">): RowStatus {
  if (r.open_dispute) return "disputed";
  if (!r.review) return "none";
  return r.review.status;
}

export const ROW_STATUS: Record<RowStatus, { label: string; tone: Tone }> = {
  none: { label: "Нет оценки", tone: "gray" },
  draft: { label: "Черновик", tone: "amber" },
  submitted: { label: "Отправлена", tone: "green" },
  disputed: { label: "Спор", tone: "red" },
};

export const VIOLATION_STATUS: Record<"active" | "cancelled", { label: string; tone: Tone }> = {
  active: { label: "Действует", tone: "red" },
  cancelled: { label: "Отменено", tone: "gray" },
};

export const DISPUTE_STATUS: Record<"open" | "accepted" | "rejected", { label: string; tone: Tone }> = {
  open: { label: "Открыт", tone: "amber" },
  accepted: { label: "Принят", tone: "green" },
  rejected: { label: "Отклонён", tone: "gray" },
};

export const RAISE_STATUS: Record<"proposed" | "insufficient" | "approved" | "rejected", { label: string; tone: Tone }> = {
  proposed: { label: "Предложено", tone: "blue" },
  insufficient: { label: "Мало оценок", tone: "gray" },
  approved: { label: "Утверждено", tone: "green" },
  rejected: { label: "Отказано", tone: "red" },
};

export const PERIOD_STATUS: Record<"open" | "closed", { label: string; tone: Tone }> = {
  open: { label: "Открыт", tone: "green" },
  closed: { label: "Закрыт", tone: "gray" },
};

const EVENT_KIND: Record<string, string> = {
  submitted: "Отправлена",
  changed: "Изменена",
  dispute_opened: "Открыт спор",
  dispute_resolved: "Спор разобран",
  hr_adjusted: "Правка HR",
};

/** Неизвестный kind (backend мог добавить новый) показываем как есть, а не прячем. */
export function eventKindLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(EVENT_KIND, kind) ? EVENT_KIND[kind] : kind;
}

export const SOURCE_LABEL: Record<ItemSource, string> = {
  manual: "Вручную",
  attendance: "Приход и уход (Workly)",
  cooking_speed: "Скорость приготовления",
  sales_plan: "План продаж",
  food_cost: "Фудкост и остатки",
};
