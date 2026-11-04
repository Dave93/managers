// Форма оценки, черновик и отправка для оценщика в мини-приложении. Тонкий слой над getForm, saveDraft
// и submitReview: проверки назначений, месяца и баллов делают они (с суженным Actor из ev-actor.ts),
// здесь только форма входа (месяц, id) и ответ без id оценщика и автора нарушения.
import { parsePeriod, type Actor, type DbLike } from "../access";
import { KpiError } from "../errors";
import { getForm, saveDraft, submitReview, type ItemInput } from "../reviews";
import type { ReviewForm, ViolationRow } from "../types";
import type { EvFormViolation, EvReviewForm } from "./ev-types";

const violationOf = (v: ViolationRow): EvFormViolation => ({ id: v.id, occurred_at: v.occurred_at, comment: v.comment });

// Ответ собирается поле за полем: evaluator_user_id и recorded_by наружу не идут.
// Отправленная оценка в приложении только читается (решение плана 2), даже если админский can_edit у неё true.
export function evFormOf(f: ReviewForm): EvReviewForm {
  return {
    period: f.period,
    period_status: f.period_status,
    employee: {
      id: f.employee.id,
      first_name: f.employee.first_name,
      last_name: f.employee.last_name,
      terminal_name: f.employee.terminal_name,
    },
    card_title: f.card.title_ru,
    review: f.review
      ? {
          id: f.review.id,
          status: f.review.status,
          score_pct: f.review.score_pct,
          version: f.review.version,
          submitted_at: f.review.submitted_at,
          late: f.review.late,
        }
      : null,
    items: f.items.map((i) => ({
      item_id: i.item_id,
      title_ru: i.title_ru,
      title_uz: i.title_uz,
      hint_ru: i.hint_ru,
      weight: i.weight,
      source: i.source,
      group_key: i.group_key,
      score: i.score,
      note: i.note,
      suggestion: i.suggestion,
      violations: i.violations.map(violationOf),
      violation_hint: i.violation_hint,
    })),
    other_violations: f.other_violations.map(violationOf),
    can_edit: f.can_edit && f.review?.status !== "submitted",
    open_dispute: f.open_dispute,
    dispute_rejected: f.dispute_rejected,
    submit_opens_at: f.deadlines.submit_opens_at,
    review_deadline: f.deadlines.review_deadline,
  };
}

// Пустой или не строковый id сотрудника — 422 bad_id; кривой по форме (не uuid) отсеивает сервис (404 not_found).
function employeeIdOf(v: unknown): string {
  if (typeof v !== "string" || v === "") throw new KpiError(422, "bad_id");
  return v;
}

export async function evForm(db: DbLike, actor: Actor, period: unknown, employeeId: unknown): Promise<EvReviewForm> {
  const p = parsePeriod(period);
  return evFormOf(await getForm(db, actor, p, employeeIdOf(employeeId)));
}

export async function evSaveDraft(
  db: DbLike,
  actor: Actor,
  body: { period?: unknown; employee_id?: unknown; items?: unknown }
): Promise<EvReviewForm> {
  const p = parsePeriod(body.period);
  const id = employeeIdOf(body.employee_id);
  return evFormOf(await saveDraft(db, actor, p, id, (body.items ?? []) as ItemInput[]));
}

export async function evSubmit(db: DbLike, actor: Actor, reviewId: string, items: ItemInput[] | undefined): Promise<EvReviewForm> {
  return evFormOf(await submitReview(db, actor, reviewId, items));
}
