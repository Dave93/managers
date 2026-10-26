// Загрузка данных мини-приложения из базы. Только отправленные оценки: черновик оценщика
// сюда не попадает ни целиком, ни баллом.
import { kpi_disputes, kpi_periods, kpi_review_events, kpi_reviews } from "backend/drizzle/schema";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { iso } from "../iso";
import type { KpiSettings } from "../rules";
import { disputeDeadline, type Period } from "../time";
import { disputeStateOf, reviewStatusOf } from "./rules";
import type { TgDisputeInfo, TgReviewStatus } from "./types";

export type SubmittedReview = { id: string; period: Period; score_pct: number | null; card_id: string };

// Отправленные оценки сотрудника с месяца from включительно, по месяцу.
export async function submittedReviews(db: DbLike, employeeId: string, from: Period): Promise<Map<Period, SubmittedReview>> {
  const rows = await db
    .select({ id: kpi_reviews.id, period: kpi_reviews.period, score_pct: kpi_reviews.score_pct, card_id: kpi_reviews.card_id })
    .from(kpi_reviews)
    .where(and(eq(kpi_reviews.employee_id, employeeId), eq(kpi_reviews.status, "submitted"), gte(kpi_reviews.period, from)));
  const out = new Map<Period, SubmittedReview>();
  for (const r of rows) {
    out.set(r.period, { id: r.id, period: r.period, score_pct: r.score_pct === null ? null : Number(r.score_pct), card_id: r.card_id });
  }
  return out;
}

type DisputeFact = { opened_at: string | null; last_resolved: TgDisputeInfo["last_resolved"] };

// По каждому объекту: когда открыт текущий спор (если открыт) и последний разобранный спор.
// Кто разбирал и кто открыл, наружу не идёт.
export async function disputeFacts(db: DbLike, type: "review" | "violation", ids: string[]): Promise<Map<string, DisputeFact>> {
  const out = new Map<string, DisputeFact>();
  for (const id of ids) out.set(id, { opened_at: null, last_resolved: null });
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      subject_id: kpi_disputes.subject_id,
      status: kpi_disputes.status,
      resolution_comment: kpi_disputes.resolution_comment,
      resolved_at: kpi_disputes.resolved_at,
      created_at: kpi_disputes.created_at,
    })
    .from(kpi_disputes)
    .where(and(eq(kpi_disputes.subject_type, type), inArray(kpi_disputes.subject_id, ids)))
    // Самый поздно разобранный первым: дальше по каждому объекту берётся первая разобранная строка.
    .orderBy(sql`${kpi_disputes.resolved_at} desc nulls last`, desc(kpi_disputes.created_at));
  for (const r of rows) {
    const f = out.get(r.subject_id);
    if (!f) continue;
    if (r.status === "open") f.opened_at = iso(r.created_at);
    else if ((r.status === "accepted" || r.status === "rejected") && f.last_resolved === null) {
      f.last_resolved = { decision: r.status, comment: r.resolution_comment, resolved_at: iso(r.resolved_at ?? r.created_at) };
    }
  }
  return out;
}

// Какие из месяцев закрыты.
export async function closedPeriods(db: DbLike, periods: Period[]): Promise<Set<Period>> {
  if (periods.length === 0) return new Set();
  const rows = await db
    .select({ period: kpi_periods.period })
    .from(kpi_periods)
    .where(and(inArray(kpi_periods.period, periods), eq(kpi_periods.status, "closed")));
  return new Set(rows.map((r) => r.period));
}

// Состояние спора и статус отправленной оценки (решения 12 и 13).
export async function reviewDispute(
  db: DbLike,
  r: { id: string; period: Period },
  at: Date,
  s: KpiSettings
): Promise<{ dispute: TgDisputeInfo; status: TgReviewStatus }> {
  const facts = (await disputeFacts(db, "review", [r.id])).get(r.id)!;
  const changed = await db
    .select({ id: kpi_review_events.id })
    .from(kpi_review_events)
    .where(and(eq(kpi_review_events.review_id, r.id), inArray(kpi_review_events.kind, ["changed", "hr_adjusted"])))
    .limit(1);
  const periodClosed = (await closedPeriods(db, [r.period])).has(r.period);
  const deadline = disputeDeadline(r.period, s.dispute_deadline_day);
  const open = facts.opened_at !== null;
  const state = disputeStateOf({ cancelled: false, open, periodClosed, deadline, at });
  return {
    dispute: {
      state,
      deadline: deadline.toISOString(),
      opened_at: state === "open" ? facts.opened_at : null,
      last_resolved: facts.last_resolved,
    },
    status: reviewStatusOf({ open, resolved: facts.last_resolved !== null, changed: changed.length > 0 }),
  };
}
