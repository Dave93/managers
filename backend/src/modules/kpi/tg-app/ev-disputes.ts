// Споры оценщика в мини-приложении. Тонкий слой над listDisputes и resolveDispute (disputes.ts):
// видимость, can_resolve, права на разбор и коды ошибок решают они под суженным Actor из ev-actor.ts.
// Здесь только форма входа, ответ без opened_via и resolved_by_name и предмет спора (оценка или нарушение).
import { kpi_reviews, kpi_violation_photos, kpi_violations } from "backend/drizzle/schema";
import { asc, inArray } from "drizzle-orm";
import type { Actor, DbLike } from "../access";
import { listDisputes, resolveDispute } from "../disputes";
import { UUID_RE } from "../employees";
import { KpiError } from "../errors";
import type { ItemInput } from "../reviews";
import { loadSettings } from "../settings";
import type { DisputeRow } from "../types";
import { evForm } from "./ev-review";
import type { EvDispute, EvDisputeDetail, EvDisputes, EvDisputeSubject } from "./ev-types";

// Ответ собирается поле за полем: opened_via и resolved_by_name наружу не идут. can_resolve — как вернул listDisputes.
function evDisputeOf(r: DisputeRow, subject: EvDisputeSubject | null): EvDispute {
  return {
    id: r.id,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    terminal_name: r.terminal_name,
    period: r.period,
    reason: r.reason,
    status: r.status,
    resolution_comment: r.resolution_comment,
    resolved_at: r.resolved_at,
    created_at: r.created_at,
    can_resolve: r.can_resolve,
    subject,
  };
}

// Предметы споров пакетом: баллы оценок, пункт и комментарий нарушений, фото нарушений по created_at.
// Ключ результата — id спора; предмета нет (строка удалена) — записи в карте нет, и subject будет null.
async function subjectsOf(db: DbLike, rows: DisputeRow[]): Promise<Map<string, EvDisputeSubject>> {
  const out = new Map<string, EvDisputeSubject>();
  const rIds = [...new Set(rows.filter((r) => r.subject_type === "review").map((r) => r.subject_id))];
  const vIds = [...new Set(rows.filter((r) => r.subject_type === "violation").map((r) => r.subject_id))];

  const scores = new Map<string, number | null>();
  if (rIds.length) {
    const rs = await db
      .select({ id: kpi_reviews.id, score_pct: kpi_reviews.score_pct })
      .from(kpi_reviews)
      .where(inArray(kpi_reviews.id, rIds));
    for (const r of rs) scores.set(r.id, r.score_pct === null ? null : Number(r.score_pct));
  }

  const vios = new Map<string, { item_title_ru: string | null; comment: string }>();
  const photos = new Map<string, string[]>();
  if (vIds.length) {
    const vs = await db
      .select({ id: kpi_violations.id, item_title_ru: kpi_violations.item_title_ru, comment: kpi_violations.comment })
      .from(kpi_violations)
      .where(inArray(kpi_violations.id, vIds));
    for (const v of vs) vios.set(v.id, { item_title_ru: v.item_title_ru, comment: v.comment });
    const ps = await db
      .select({ id: kpi_violation_photos.id, violation_id: kpi_violation_photos.violation_id })
      .from(kpi_violation_photos)
      .where(inArray(kpi_violation_photos.violation_id, vIds))
      .orderBy(asc(kpi_violation_photos.created_at), asc(kpi_violation_photos.id));
    for (const p of ps) photos.set(p.violation_id, [...(photos.get(p.violation_id) ?? []), p.id]);
  }

  for (const r of rows) {
    if (r.subject_type === "review") {
      if (scores.has(r.subject_id)) out.set(r.id, { kind: "review", score_pct: scores.get(r.subject_id) ?? null });
    } else {
      const v = vios.get(r.subject_id);
      if (v) out.set(r.id, { kind: "violation", item_title_ru: v.item_title_ru, comment: v.comment, photo_ids: photos.get(r.subject_id) ?? [] });
    }
  }
  return out;
}

// status — как пришёл в query: проверку (open | accepted | rejected, иначе 422 bad_status) делает listDisputes.
// Порядок и состав строк — как у listDisputes, без собственной фильтрации (решение плана 8).
export async function evDisputes(db: DbLike, actor: Actor, status: unknown): Promise<EvDisputes> {
  const rows = await listDisputes(db, actor, { status: status as string | undefined });
  const subjects = await subjectsOf(db, rows);
  return { items: rows.map((r) => evDisputeOf(r, subjects.get(r.id) ?? null)) };
}

// Спор виден, только если он есть среди listDisputes: чужой и несуществующий неотличимы (404 not_found).
// Форма оценки приходит из evForm под тем же Actor: если сотрудник уже вне назначения, а спор виден по снимку,
// evForm отвечает своей ошибкой (403 out_of_scope, 404 no_card), и она идёт наружу как есть.
export async function evDisputeDetail(db: DbLike, actor: Actor, id: string): Promise<EvDisputeDetail> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const row = (await listDisputes(db, actor, {})).find((r) => r.id === id);
  if (!row) throw new KpiError(404, "not_found");
  const subjects = await subjectsOf(db, [row]);
  const settings = await loadSettings(db);
  const form = row.subject_type === "review" ? await evForm(db, actor, row.period, row.employee_id) : null;
  return { dispute: evDisputeOf(row, subjects.get(row.id) ?? null), comment_min: settings.change_comment_min, form };
}

// Авторизации здесь нет: автора, назначение, закрытый спор, закрытый месяц и баллы проверяет resolveDispute.
// Ответ — спор без предмета (subject: null): после разбора экран перезагружает карточку.
export async function evResolve(
  db: DbLike,
  actor: Actor,
  id: string,
  body: { decision?: unknown; comment?: unknown; items?: ItemInput[] }
): Promise<EvDispute> {
  const row = await resolveDispute(db, actor, id, {
    decision: body.decision as "accepted" | "rejected",
    comment: body.comment as string,
    items: body.items,
  });
  return evDisputeOf(row, null);
}
