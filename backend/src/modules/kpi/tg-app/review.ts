// «Вся оценка», нарушения, фото и спор мини-приложения «Мой KPI». employeeId — только из сессии.
// Чужое, черновик и несуществующее неотличимы: 404 not_found (решение 14).
// Ответы собираются поле за полем: оценщик (evaluator_user_id, recorded_by, actor_user_id) наружу не уходит.
import { kpi_card_items, kpi_review_events, kpi_review_items, kpi_reviews, kpi_violation_photos, kpi_violations } from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { parsePeriod, type DbLike } from "../access";
import { openDispute } from "../disputes";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import { iso } from "../iso";
import { loadSettings } from "../settings";
import { resolveUploadFile } from "../storage";
import { disputeDeadline } from "../time";
import { closedPeriods, disputeFacts, reviewDispute, tgTiers } from "./load";
import { disputeStateOf } from "./rules";
import type { TgDisputeCreated, TgItemSource, TgReview, TgReviewChange, TgReviewItem, TgViolation, TgViolations } from "./types";

const notFound = (): KpiError => new KpiError(404, "not_found");
const pct = (v: string | null): number | null => (v === null ? null : Number(v));

// Отправленная оценка сотрудника за месяц. Пункты: сначала base, потом extra, внутри по sort карты оценки;
// пункта в карте уже нет — base, после остальных.
export async function reviewFor(db: DbLike, employeeId: string, period: unknown, at: Date): Promise<TgReview> {
  const p = parsePeriod(period);
  const [r] = await db
    .select({
      id: kpi_reviews.id,
      period: kpi_reviews.period,
      card_id: kpi_reviews.card_id,
      score_pct: kpi_reviews.score_pct,
      submitted_at: kpi_reviews.submitted_at,
      updated_at: kpi_reviews.updated_at,
    })
    .from(kpi_reviews)
    .where(and(eq(kpi_reviews.employee_id, employeeId), eq(kpi_reviews.period, p), eq(kpi_reviews.status, "submitted")))
    .limit(1);
  if (!r) throw notFound();
  const s = await loadSettings(db);

  const rows = await db
    .select({
      item_id: kpi_review_items.item_id,
      title_ru: kpi_review_items.title_ru,
      title_uz: kpi_review_items.title_uz,
      score: kpi_review_items.score,
      source: kpi_review_items.source,
      note: kpi_review_items.note,
      group_key: kpi_card_items.group_key,
      sort: kpi_card_items.sort,
    })
    .from(kpi_review_items)
    .leftJoin(kpi_card_items, and(eq(kpi_card_items.id, kpi_review_items.item_id), eq(kpi_card_items.card_id, r.card_id)))
    .where(eq(kpi_review_items.review_id, r.id));
  const keyed = rows.map((i) => ({
    group: i.group_key === "extra" ? 1 : 0,
    sort: i.sort ?? Number.MAX_SAFE_INTEGER,
    item: {
      item_id: i.item_id,
      title_ru: i.title_ru,
      title_uz: i.title_uz,
      group_key: i.group_key === "extra" ? "extra" : "base",
      score: i.score,
      source: i.source as TgItemSource,
      note: i.note,
    } satisfies TgReviewItem,
  }));
  keyed.sort((a, b) => a.group - b.group || a.sort - b.sort || a.item.item_id.localeCompare(b.item.item_id));

  // Правки после отправки: старый и новый балл и причина; кто правил, не читаем.
  const events = await db
    .select({
      created_at: kpi_review_events.created_at,
      old_score_pct: kpi_review_events.old_score_pct,
      new_score_pct: kpi_review_events.new_score_pct,
      comment: kpi_review_events.comment,
    })
    .from(kpi_review_events)
    .where(and(eq(kpi_review_events.review_id, r.id), inArray(kpi_review_events.kind, ["changed", "hr_adjusted"])))
    .orderBy(asc(kpi_review_events.created_at), asc(kpi_review_events.id));
  const changes: TgReviewChange[] = events.map((e) => ({
    at: iso(e.created_at),
    old_score_pct: pct(e.old_score_pct),
    new_score_pct: pct(e.new_score_pct),
    comment: e.comment,
  }));

  const { dispute, status } = await reviewDispute(db, { id: r.id, period: r.period }, at, s);
  return {
    period: r.period,
    review_id: r.id,
    score_pct: pct(r.score_pct),
    status,
    // Отправка всегда пишет submitted_at; пустое поле в старой строке — время последней записи, а не пустая строка.
    submitted_at: iso(r.submitted_at ?? r.updated_at),
    items: keyed.map((k) => k.item),
    changes,
    dispute,
    reason_min: s.change_comment_min,
    tiers: await tgTiers(db),
  };
}

// Свои нарушения месяца, все статусы, новые сверху. Название пункта по-русски — снимок в нарушении,
// по-узбекски — из пункта карты.
export async function violationsOf(db: DbLike, employeeId: string, period: unknown, at: Date): Promise<TgViolations> {
  const p = parsePeriod(period);
  const s = await loadSettings(db);
  const rows = await db
    .select({
      id: kpi_violations.id,
      item_title_ru: kpi_violations.item_title_ru,
      item_title_uz: kpi_card_items.title_uz,
      occurred_at: kpi_violations.occurred_at,
      comment: kpi_violations.comment,
      status: kpi_violations.status,
      cancel_reason: kpi_violations.cancel_reason,
    })
    .from(kpi_violations)
    .leftJoin(kpi_card_items, eq(kpi_card_items.id, kpi_violations.card_item_id))
    .where(and(eq(kpi_violations.employee_id, employeeId), eq(kpi_violations.period, p)))
    .orderBy(desc(kpi_violations.occurred_at), desc(kpi_violations.id));
  const ids = rows.map((v) => v.id);

  const photos = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length) {
    const ph = await db
      .select({ id: kpi_violation_photos.id, violation_id: kpi_violation_photos.violation_id })
      .from(kpi_violation_photos)
      .where(inArray(kpi_violation_photos.violation_id, ids))
      .orderBy(asc(kpi_violation_photos.created_at), asc(kpi_violation_photos.id));
    for (const x of ph) photos.get(x.violation_id)?.push(x.id);
  }

  // Состояние спора — тем же disputeStateOf, что у оценки (решение 13); у нарушения ещё «отменено».
  const facts = await disputeFacts(db, "violation", ids);
  const periodClosed = (await closedPeriods(db, [p])).has(p);
  const deadline = disputeDeadline(p, s.dispute_deadline_day);
  const items: TgViolation[] = rows.map((v) => {
    const f = facts.get(v.id) ?? { opened_at: null, last_resolved: null };
    const cancelled = v.status === "cancelled";
    const state = disputeStateOf({ cancelled, open: f.opened_at !== null, periodClosed, deadline, at });
    return {
      id: v.id,
      item_title_ru: v.item_title_ru,
      item_title_uz: v.item_title_uz,
      occurred_at: iso(v.occurred_at),
      comment: v.comment,
      status: cancelled ? "cancelled" : "active",
      cancel_reason: v.cancel_reason,
      photo_ids: photos.get(v.id) ?? [],
      dispute: {
        state,
        deadline: deadline.toISOString(),
        opened_at: state === "open" ? f.opened_at : null,
        last_resolved: f.last_resolved,
      },
    };
  });
  return { period: p, items, reason_min: s.change_comment_min };
}

// Файл фото своего нарушения. Путь проверяет resolveUploadFile — та же проверка, что у админки.
export async function ownPhoto(db: DbLike, employeeId: string, photoId: string): Promise<{ path: string; mime: string }> {
  if (!UUID_RE.test(photoId)) throw notFound();
  const [p] = await db
    .select({ file_path: kpi_violation_photos.file_path, mime: kpi_violation_photos.mime })
    .from(kpi_violation_photos)
    .innerJoin(kpi_violations, eq(kpi_violations.id, kpi_violation_photos.violation_id))
    .where(and(eq(kpi_violation_photos.id, photoId), eq(kpi_violations.employee_id, employeeId)))
    .limit(1);
  if (!p) throw notFound();
  const file = resolveUploadFile(p.file_path);
  if (file === null) throw notFound();
  return { path: file, mime: p.mime };
}

// Запись принадлежит сотруднику; оценка — ещё и отправлена (черновика для него нет).
async function ownSubject(db: DbLike, employeeId: string, type: "review" | "violation", id: string): Promise<boolean> {
  if (type === "review") {
    const [r] = await db
      .select({ id: kpi_reviews.id })
      .from(kpi_reviews)
      .where(and(eq(kpi_reviews.id, id), eq(kpi_reviews.employee_id, employeeId), eq(kpi_reviews.status, "submitted")))
      .limit(1);
    return r !== undefined;
  }
  const [v] = await db
    .select({ id: kpi_violations.id })
    .from(kpi_violations)
    .where(and(eq(kpi_violations.id, id), eq(kpi_violations.employee_id, employeeId)))
    .limit(1);
  return v !== undefined;
}

// Спор из мини-приложения. openDispute с employee_actor владельца записи не проверяет, поэтому
// чужая запись и черновик отсекаются здесь, до вызова: 404 и ни одной строки в kpi_disputes.
// Остальные ошибки (короткая причина, отменено, срок, месяц закрыт, повтор) — коды openDispute.
export async function disputeFromApp(
  db: DbLike,
  employeeId: string,
  body: { subject_type?: unknown; subject_id?: unknown; reason?: unknown }
): Promise<TgDisputeCreated> {
  const type = body.subject_type;
  if (type !== "review" && type !== "violation") throw new KpiError(422, "bad_subject_type");
  const id = body.subject_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) throw notFound();
  if (!(await ownSubject(db, employeeId, type, id))) throw notFound();
  // Не строка — как пустая причина: openDispute ответит 422 comment_required с минимумом.
  const reason = typeof body.reason === "string" ? body.reason : "";
  const d = await openDispute(db, null, { subject_type: type, subject_id: id, reason, via: "miniapp", employee_actor: true });
  return { id: d.id, subject_type: d.subject_type, subject_id: d.subject_id, created_at: d.created_at };
}
