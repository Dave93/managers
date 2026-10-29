// Статусы и подписи KPI. Подписи — строго по спеке экранов, тон — цвет бейджа.
import type { EmployeeRow, ItemSource } from "@admin/lib/kpi-api";
import { ruT, type KpiT } from "./i18n";

export type Tone = "gray" | "amber" | "green" | "red" | "blue";
export type RowStatus = "none" | "draft" | "submitted" | "disputed";

/** Открытый спор важнее статуса оценки: строку с ним HR должен заметить первой. */
export function rowStatus(r: Pick<EmployeeRow, "review" | "open_dispute">): RowStatus {
  if (r.open_dispute) return "disputed";
  if (!r.review) return "none";
  return r.review.status;
}

/** label — русский запасной текст; в интерфейсе переводите `t(labelKey)`. */
export type StatusMeta = { label: string; labelKey: string; tone: Tone };
const meta = (labelKey: string, tone: Tone): StatusMeta => ({ label: ruT(labelKey), labelKey, tone });

export const ROW_STATUS: Record<RowStatus, StatusMeta> = {
  none: meta("lib.status.row.none", "gray"),
  draft: meta("lib.status.row.draft", "amber"),
  submitted: meta("lib.status.row.submitted", "green"),
  disputed: meta("lib.status.row.disputed", "red"),
};

export const VIOLATION_STATUS: Record<"active" | "cancelled", StatusMeta> = {
  active: meta("lib.status.violation.active", "red"),
  cancelled: meta("lib.status.violation.cancelled", "gray"),
};

export const DISPUTE_STATUS: Record<"open" | "accepted" | "rejected", StatusMeta> = {
  open: meta("lib.status.dispute.open", "amber"),
  accepted: meta("lib.status.dispute.accepted", "green"),
  rejected: meta("lib.status.dispute.rejected", "gray"),
};

export const RAISE_STATUS: Record<"proposed" | "insufficient" | "approved" | "rejected", StatusMeta> = {
  proposed: meta("lib.status.raise.proposed", "blue"),
  insufficient: meta("lib.status.raise.insufficient", "gray"),
  approved: meta("lib.status.raise.approved", "green"),
  rejected: meta("lib.status.raise.rejected", "red"),
};

export const PERIOD_STATUS: Record<"open" | "closed", StatusMeta> = {
  open: meta("lib.status.period.open", "green"),
  closed: meta("lib.status.period.closed", "gray"),
};

const EVENT_KINDS = ["submitted", "changed", "dispute_opened", "dispute_resolved", "hr_adjusted"];

/** Неизвестный kind (backend мог добавить новый) показываем как есть, а не прячем. */
export function eventKindLabel(kind: string, t: KpiT = ruT): string {
  return EVENT_KINDS.includes(kind) ? t(`lib.event.kind.${kind}`) : kind;
}

/** Кто сделал запись в истории: пользователь по имени, сотрудник (спор из Telegram) или система. */
export function eventActorLabel(e: { actor_kind: string; actor_name: string | null }, t: KpiT = ruT): string {
  if (e.actor_name) return e.actor_name;
  return e.actor_kind === "employee" ? t("lib.event.actor.employee") : t("lib.event.actor.system");
}

/** Ключи подписей источников пункта: `t(SOURCE_LABEL_KEY[source])`. */
export const SOURCE_LABEL_KEY: Record<ItemSource, string> = {
  manual: "lib.source.manual",
  attendance: "lib.source.attendance",
  cooking_speed: "lib.source.cooking_speed",
  sales_plan: "lib.source.sales_plan",
  food_cost: "lib.source.food_cost",
};

/** Русские подписи (запасной вариант без `t`). */
export const SOURCE_LABEL: Record<ItemSource, string> = Object.fromEntries(
  Object.entries(SOURCE_LABEL_KEY).map(([k, key]) => [k, ruT(key)])
) as Record<ItemSource, string>;
