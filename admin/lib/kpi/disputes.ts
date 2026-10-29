// Споры: разделение на открытые и закрытые, проверка разбора, подпись предмета.
import type { DisputeRow } from "@admin/lib/kpi-api";
import { monthLabel } from "@admin/lib/kpi/periods";
import { ruT, type KpiT } from "@admin/lib/kpi/i18n";
import { commentOk } from "@admin/lib/kpi/review-form";

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Открытые — старые первыми (дольше всех ждут), закрытые — свежие первыми. */
export function splitDisputes<T extends Pick<DisputeRow, "status" | "created_at" | "resolved_at">>(
  rows: readonly T[]
): { open: T[]; closed: T[] } {
  const open = rows.filter((r) => r.status === "open").sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const closed = rows.filter((r) => r.status !== "open").sort((a, b) => ms(b.resolved_at) - ms(a.resolved_at));
  return { open, closed };
}

/**
 * Что мешает отправить решение. Комментарий нужен при любом решении; `commentMin` — settings.change_comment_min
 * (букв и цифр, как на сервере). Принятый спор по оценке обязан менять хотя бы один балл.
 */
export function resolveIssues(
  subject: "review" | "violation",
  decision: "accepted" | "rejected",
  comment: string,
  changedCount: number,
  commentMin = 1,
  t: KpiT = ruT
): string[] {
  const out: string[] = [];
  if (!commentOk(comment, Math.max(1, commentMin))) {
    out.push(commentMin > 1 ? t("lib.disputes.commentMin", { min: commentMin }) : t("lib.disputes.commentRequired"));
  }
  if (subject === "review" && decision === "accepted" && changedCount === 0) {
    out.push(t("lib.disputes.acceptedNeedsChange"));
  }
  return out;
}

export function subjectLabel(d: Pick<DisputeRow, "subject_type" | "period">, t: KpiT = ruT, locale = "ru"): string {
  const month = monthLabel(d.period, locale);
  return d.subject_type === "review" ? t("lib.disputes.subjectReview", { month }) : t("lib.disputes.subjectViolation", { month });
}
