import type { DrizzleDB } from "@backend/lib/db";
import { kpi_card_items, kpi_cards, kpi_review_events, kpi_review_items, kpi_reviews } from "backend/drizzle/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { has, loadScopes, type Actor, type DbLike } from "./access";
import { attendanceStats } from "./attendance";
import type { AttendanceStats } from "./attendance-parse";
import { now } from "./clock";
import { canEvaluate, canSeeEither, loadDirectory, userNames, type DirEmployee } from "./directory";
import { listEmployeeRows, UUID_RE, type EmployeeQuery } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { deadlinesOf, isPeriodClosed, lockPeriodShared } from "./periods";
import {
  commentOk,
  diffScores,
  isScore,
  missingManual,
  noDataNoteRequired,
  noteRequired,
  scorePct,
  violationHint,
  type ItemSource,
  type Scope,
} from "./rules";
import { loadSettings } from "./settings";
import { enqueue } from "./notify";
import { reviewDeadline, submitOpensAt, type Period } from "./time";
import { hasOpenDispute, violationsFor } from "./violations";
import type { EmployeeRow, ReviewEvent, ReviewForm, ReviewFormItem } from "./types";

export type ItemInput = { item_id: string; score: number | null; note?: string | null };

type AutoValue = { source: "attendance" } & AttendanceStats;
type Suggestion = { score: number; basis: string; auto_value: AutoValue | null };
type ReviewRow = typeof kpi_reviews.$inferSelect;
// Рабочая строка пункта: снимок карты плюс оценка.
type WorkItem = {
  item_id: string;
  title_ru: string;
  title_uz: string;
  weight: number;
  source: ItemSource;
  score: number | null;
  note: string | null;
  auto_value: unknown;
};
type Meta = { hint_ru: string | null; group_key: "base" | "extra"; sort: number };

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

// Предложения автопунктов. Отправленная оценка берёт их из снимка auto_value,
// черновик и новая форма считают по живым данным Workly.
async function loadSuggestions(
  db: DbLike,
  target: { employee_id: string; period: Period; status: "draft" | "submitted" | null },
  items: WorkItem[]
): Promise<Map<string, Suggestion>> {
  const out = new Map<string, Suggestion>();
  if (target.status === "submitted") {
    for (const i of items) {
      const v = i.auto_value as { score?: unknown; basis?: unknown } | null;
      if (v && typeof v === "object" && typeof v.score === "number" && typeof v.basis === "string") {
        out.set(i.item_id, { score: v.score, basis: v.basis, auto_value: v as AutoValue });
      }
    }
    return out;
  }
  const att = items.filter((i) => i.source === "attendance");
  if (att.length > 0) {
    const stats = await attendanceStats(db, target.employee_id, target.period);
    if (stats) {
      for (const i of att) {
        out.set(i.item_id, { score: stats.score, basis: stats.basis, auto_value: { source: "attendance", ...stats } });
      }
    }
  }
  return out;
}

// Отправка и изменение: «нет данных» у автопункта с предложением без заметки — 422.
// Черновик это не проверяет, поэтому проверка отдельно от applyInputs.
function checkNoDataNotes(items: WorkItem[], suggestions: Map<string, Suggestion>): void {
  for (const it of items) {
    if (noDataNoteRequired(it.source, suggestions.get(it.item_id) ?? null, it.score, it.note)) {
      throw new KpiError(422, "note_required", { item_id: it.item_id });
    }
  }
}

// В ответ API уходят только балл и основание, снимок остаётся внутри.
const suggestionOf = (s: Suggestion | undefined): { score: number; basis: string } | null =>
  s ? { score: s.score, basis: s.basis } : null;

const normNote = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const pctStr = (v: number | null): string | null => (v === null ? null : v.toFixed(2));
const pctNum = (v: string | null): number | null => (v === null ? null : Number(v));

async function loadEmployee(db: DbLike, id: string): Promise<DirEmployee> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const [e] = await loadDirectory(db, { employeeIds: [id], includeInactive: true });
  if (!e) throw new KpiError(404, "not_found");
  return e;
}

async function loadReview(db: DbLike, id: string, lock = false): Promise<ReviewRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  const q = db.select().from(kpi_reviews).where(eq(kpi_reviews.id, id));
  const [r] = lock ? await q.for("update") : await q;
  if (!r) throw new KpiError(404, "not_found");
  return r;
}

async function currentItems(db: DbLike, cardId: string) {
  return db
    .select()
    .from(kpi_card_items)
    .where(and(eq(kpi_card_items.card_id, cardId), eq(kpi_card_items.active, true)))
    .orderBy(asc(kpi_card_items.sort), asc(kpi_card_items.id));
}

async function reviewRows(db: DbLike, reviewId: string): Promise<WorkItem[]> {
  const rows = await db.select().from(kpi_review_items).where(eq(kpi_review_items.review_id, reviewId));
  return rows.map((r) => ({
    item_id: r.item_id,
    title_ru: r.title_ru,
    title_uz: r.title_uz,
    weight: r.weight,
    source: r.source as ItemSource,
    score: r.score,
    note: r.note,
    auto_value: r.auto_value,
  }));
}

async function cardInfo(db: DbLike, cardId: string) {
  const [c] = await db
    .select({ id: kpi_cards.id, code: kpi_cards.code, title_ru: kpi_cards.title_ru })
    .from(kpi_cards)
    .where(eq(kpi_cards.id, cardId))
    .limit(1);
  if (!c) throw new KpiError(422, "no_card");
  return c;
}

// Проверка ввода и применение к пунктам; возвращает новый список, исходный не меняет.
function applyInputs(
  base: WorkItem[],
  inputs: ItemInput[],
  suggestions: Map<string, Suggestion>
): WorkItem[] {
  const byId = new Map(base.map((i) => [i.item_id, { ...i }]));
  for (const inp of inputs) {
    const it = byId.get(inp.item_id);
    if (!it) throw new KpiError(422, "unknown_item", { item_id: inp.item_id });
    const score = inp.score === undefined ? NaN : inp.score;
    if (score !== null && !isScore(score)) throw new KpiError(422, "bad_score", { item_id: inp.item_id });
    it.score = score;
    if (inp.note !== undefined) it.note = normNote(inp.note);
  }
  // Заметку проверяем по всем пунктам, а не только по присланным: предложение могло появиться после черновика.
  const out = base.map((i) => byId.get(i.item_id)!);
  for (const it of out) {
    if (noteRequired(suggestions.get(it.item_id) ?? null, it.score, it.note)) {
      throw new KpiError(422, "note_required", { item_id: it.item_id });
    }
  }
  return out;
}

function pctOf(items: WorkItem[]): number | null {
  return scorePct(items.map((i) => ({ item_id: i.item_id, weight: i.weight, source: i.source, score: i.score })));
}

// Пересобирает строки черновика по активным пунктам текущей карты сотрудника,
// баллы и заметки совпавших item_id сохраняются. Без карты строки остаются как есть.
async function syncDraft(tx: DbLike, review: ReviewRow, emp: DirEmployee, inputs: ItemInput[]): Promise<WorkItem[]> {
  const existing = await reviewRows(tx, review.id);
  if (emp.card_id === null) {
    if (inputs.length) throw new KpiError(422, "no_card");
    return existing;
  }
  const prev = new Map(existing.map((r) => [r.item_id, r]));
  const cur = await currentItems(tx, emp.card_id);
  const base: WorkItem[] = cur.map((c) => ({
    item_id: c.id,
    title_ru: c.title_ru,
    title_uz: c.title_uz,
    weight: c.weight,
    source: c.source as ItemSource,
    score: prev.get(c.id)?.score ?? null,
    note: prev.get(c.id)?.note ?? null,
    auto_value: prev.get(c.id)?.auto_value ?? null,
  }));
  const suggestions = await loadSuggestions(
    tx,
    { employee_id: review.employee_id, period: review.period, status: review.status as "draft" | "submitted" },
    base
  );
  // В снимок попадает предложение на момент сохранения (при отправке это и есть снимок отправки).
  const items = applyInputs(base, inputs, suggestions).map((i) => ({
    ...i,
    auto_value: suggestions.get(i.item_id)?.auto_value ?? null,
  }));
  await tx.delete(kpi_review_items).where(eq(kpi_review_items.review_id, review.id));
  if (items.length) {
    await tx.insert(kpi_review_items).values(
      items.map((i) => ({
        review_id: review.id,
        item_id: i.item_id,
        title_ru: i.title_ru,
        title_uz: i.title_uz,
        weight: i.weight,
        source: i.source,
        score: i.score,
        auto_value: i.auto_value ?? null,
        note: i.note,
      }))
    );
  }
  await tx
    .update(kpi_reviews)
    .set({
      card_id: emp.card_id,
      terminal_id: emp.terminal_id,
      score_pct: pctStr(pctOf(items)),
      updated_at: now().toISOString(),
    })
    .where(eq(kpi_reviews.id, review.id));
  return items;
}

async function scopesOf(db: DbLike, actor: Actor): Promise<Scope[]> {
  return loadScopes(db, actor.userId);
}

// Может ли actor сохранять черновик за сотрудника сейчас (без учёта закрытия месяца).
function mayDraft(actor: Actor, scopes: Scope[], emp: DirEmployee): boolean {
  return emp.card_id !== null && canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id });
}

// Может ли actor менять отправленную оценку: оценщик из назначений в открытом месяце или kpi.approve.
function mayChange(actor: Actor, scopes: Scope[], review: ReviewRow, closed: boolean): boolean {
  if (has(actor, "kpi.approve")) return true;
  if (closed) return false;
  return canEvaluate(actor, scopes, { terminal_id: review.terminal_id, card_id: review.card_id });
}

async function buildForm(
  db: DbLike,
  actor: Actor,
  scopes: Scope[],
  emp: DirEmployee,
  period: Period,
  review: ReviewRow | null
): Promise<ReviewForm> {
  const settings = await loadSettings(db);
  const closed = await isPeriodClosed(db, period);
  const deadline = reviewDeadline(period, settings.review_deadline_day).getTime();

  // Отправленная оценка и черновик без действующей карты берутся из снимка, остальное из текущей карты.
  const fromSnapshot = review !== null && (review.status === "submitted" || emp.card_id === null);
  const cardId = fromSnapshot ? review!.card_id : emp.card_id;
  if (!cardId) throw new KpiError(422, "no_card");
  const card = await cardInfo(db, cardId);

  let work: WorkItem[];
  const meta = new Map<string, Meta>();
  if (fromSnapshot) {
    work = await reviewRows(db, review!.id);
    const ids = work.map((w) => w.item_id);
    if (ids.length) {
      const m = await db.select().from(kpi_card_items).where(inArray(kpi_card_items.id, ids));
      for (const r of m) meta.set(r.id, { hint_ru: r.hint_ru, group_key: r.group_key as "base" | "extra", sort: r.sort });
    }
  } else {
    const cur = await currentItems(db, cardId);
    const prev = new Map((review ? await reviewRows(db, review.id) : []).map((r) => [r.item_id, r]));
    work = cur.map((c) => ({
      item_id: c.id,
      title_ru: c.title_ru,
      title_uz: c.title_uz,
      weight: c.weight,
      source: c.source as ItemSource,
      score: prev.get(c.id)?.score ?? null,
      note: prev.get(c.id)?.note ?? null,
      auto_value: null,
    }));
    for (const c of cur) meta.set(c.id, { hint_ru: c.hint_ru, group_key: c.group_key as "base" | "extra", sort: c.sort });
  }
  work.sort(
    (a, b) =>
      (meta.get(a.item_id)?.sort ?? 1e9) - (meta.get(b.item_id)?.sort ?? 1e9) || a.item_id.localeCompare(b.item_id)
  );
  const suggestions = await loadSuggestions(
    db,
    { employee_id: emp.id, period, status: (review?.status as "draft" | "submitted" | undefined) ?? null },
    work
  );
  const violations = await violationsFor(db, emp.id, period);
  const itemIds = new Set(work.map((w) => w.item_id));
  const items: ReviewFormItem[] = work.map((w) => {
    const own = violations.filter((v) => v.card_item_id === w.item_id);
    return {
      item_id: w.item_id,
      title_ru: w.title_ru,
      title_uz: w.title_uz,
      hint_ru: meta.get(w.item_id)?.hint_ru ?? null,
      weight: w.weight,
      source: w.source,
      group_key: meta.get(w.item_id)?.group_key ?? "base",
      score: w.score,
      note: w.note,
      suggestion: suggestionOf(suggestions.get(w.item_id)),
      violations: own,
      violation_hint: own.length > 0 ? violationHint(own.length, settings.violation_penalty_hint) : null,
    };
  });

  const submitted = review?.status === "submitted";
  const canEdit = submitted
    ? mayChange(actor, scopes, review!, closed)
    : !closed && mayDraft(actor, scopes, emp);
  const scoreNow = submitted ? pctNum(review!.score_pct) : pctOf(work);
  const openDispute = review ? await hasOpenDispute(db, "review", review.id) : false;

  return {
    period,
    period_status: closed ? "closed" : "open",
    employee: {
      id: emp.id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      terminal_id: emp.terminal_id,
      terminal_name: emp.terminal_name,
    },
    card,
    review: review
      ? {
          id: review.id,
          status: review.status as "draft" | "submitted",
          score_pct: scoreNow,
          version: review.version,
          submitted_at: iso(review.submitted_at),
          evaluator_user_id: review.evaluator_user_id,
          late: review.submitted_at ? new Date(review.submitted_at).getTime() > deadline : now().getTime() > deadline,
        }
      : null,
    items,
    other_violations: violations.filter((v) => v.card_item_id === null || !itemIds.has(v.card_item_id)),
    can_edit: canEdit,
    needs_comment: submitted,
    open_dispute: openDispute,
    deadlines: deadlinesOf(period, settings),
  };
}

export async function getForm(db: DbLike, actor: Actor, period: Period, employeeId: string): Promise<ReviewForm> {
  const emp = await loadEmployee(db, employeeId);
  const scopes = await scopesOf(db, actor);
  const [review] = await db
    .select()
    .from(kpi_reviews)
    .where(and(eq(kpi_reviews.period, period), eq(kpi_reviews.employee_id, emp.id)))
    .limit(1);
  // Видно по текущему положению сотрудника или по снимку оценки (общее правило с reviewEvents).
  const visible = canSeeEither(
    actor,
    scopes,
    { terminal_id: emp.terminal_id, card_id: emp.card_id },
    review ? { terminal_id: review.terminal_id, card_id: review.card_id } : null
  );
  if (!visible) throw new KpiError(403, "out_of_scope");
  if (emp.card_id === null && !review) throw new KpiError(422, "no_card");
  return buildForm(db, actor, scopes, emp, period, review ?? null);
}

export async function saveDraft(
  db: DbLike,
  actor: Actor,
  period: Period,
  employeeId: string,
  items: ItemInput[]
): Promise<ReviewForm> {
  const emp = await loadEmployee(db, employeeId);
  return inTx(db, async (tx) => {
    const scopes = await scopesOf(tx, actor);
    // Без назначения не раскрываем даже отсутствие карты.
    if (!has(actor, "kpi.evaluate") || !canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id })) {
      throw new KpiError(403, "out_of_scope");
    }
    if (emp.card_id === null) throw new KpiError(422, "no_card");

    // Гонку двух черновиков снимает on conflict; строку блокируем до конца транзакции.
    // Месяц блокируем после оценки (общий порядок блокировок); в закрытом месяце вставка откатится.
    await tx
      .insert(kpi_reviews)
      .values({
        period,
        employee_id: emp.id,
        terminal_id: emp.terminal_id,
        card_id: emp.card_id,
        evaluator_user_id: actor.userId,
        status: "draft",
      })
      .onConflictDoNothing({ target: [kpi_reviews.period, kpi_reviews.employee_id] });
    const [locked] = await tx
      .select()
      .from(kpi_reviews)
      .where(and(eq(kpi_reviews.period, period), eq(kpi_reviews.employee_id, emp.id)))
      .for("update");
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
    if (locked.status === "submitted") throw new KpiError(409, "already_submitted");

    await syncDraft(tx, locked, emp, items);
    const review = await loadReview(tx, locked.id);
    return buildForm(tx, actor, scopes, emp, period, review);
  });
}

export async function submitReview(
  db: DbLike,
  actor: Actor,
  reviewId: string,
  items?: ItemInput[]
): Promise<ReviewForm> {
  return inTx(db, async (tx) => {
    const review = await loadReview(tx, reviewId, true);
    const period = review.period;
    const emp = await loadEmployee(tx, review.employee_id);
    const scopes = await scopesOf(tx, actor);
    const target =
      emp.card_id !== null
        ? { terminal_id: emp.terminal_id, card_id: emp.card_id }
        : { terminal_id: review.terminal_id, card_id: review.card_id };
    if (!canEvaluate(actor, scopes, target)) throw new KpiError(403, "out_of_scope");
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");
    if (review.status === "submitted") throw new KpiError(409, "already_submitted");
    const opens = submitOpensAt(period);
    if (now().getTime() < opens.getTime()) throw new KpiError(409, "too_early", { opens_at: opens.toISOString() });

    // Перед отправкой строки приводятся к текущей карте, со вводом из тела, если он есть.
    const rows = await syncDraft(tx, review, emp, items ?? []);
    // Карта без активных пунктов: оценивать нечего, пустую оценку не отправляем.
    if (rows.length === 0) throw new KpiError(422, "no_items");
    const missing = missingManual(rows.map((i) => ({ item_id: i.item_id, weight: i.weight, source: i.source, score: i.score })));
    if (missing.length) throw new KpiError(422, "missing_items", { items: missing });
    // syncDraft записал в auto_value предложение на момент отправки: проверяем по этому снимку.
    checkNoDataNotes(rows, await loadSuggestions(tx, { employee_id: review.employee_id, period, status: "submitted" }, rows));

    const pct = pctOf(rows);
    const at = now().toISOString();
    await tx
      .update(kpi_reviews)
      .set({ status: "submitted", submitted_at: at, score_pct: pctStr(pct), updated_at: at })
      .where(eq(kpi_reviews.id, review.id));
    await tx.insert(kpi_review_events).values({
      review_id: review.id,
      actor_kind: "user",
      actor_user_id: actor.userId,
      kind: "submitted",
      changes: [],
      old_score_pct: null,
      new_score_pct: pctStr(pct),
      comment: null,
    });
    await enqueue(tx, {
      recipient_kind: "employee",
      employee_id: review.employee_id,
      kind: "review_submitted",
      payload: { period, review_id: review.id, score_pct: pct },
      dedupe_key: `review_submitted:${review.id}`,
    });
    const fresh = await loadReview(tx, review.id);
    return buildForm(tx, actor, scopes, emp, period, fresh);
  });
}

// Изменение отправленной оценки внутри чужой транзакции: её зовёт и changeReview, и разбор спора.
// rightsChecked: права вызывающий уже проверил (разбор спора), остаётся проверка закрытого месяца.
// Без него (прямая правка) оценку с открытым спором менять нельзя: её меняет только разбор спора.
export async function changeReviewTx(
  tx: DbLike,
  actor: Actor,
  reviewId: string,
  items: ItemInput[],
  comment: string,
  kind?: "changed" | "hr_adjusted",
  opts: { rightsChecked?: boolean } = {}
): Promise<ReviewForm> {
  const review = await loadReview(tx, reviewId, true);
  const period = review.period;
  if (review.status !== "submitted") throw new KpiError(409, "not_submitted");
  const scopes = await scopesOf(tx, actor);
  const closed = await lockPeriodShared(tx, period);
  // Закрытый месяц: оценщику отвечаем состоянием, а не отсутствием прав, если право было бы в открытом.
  if (opts.rightsChecked) {
    if (closed && !has(actor, "kpi.approve")) throw new KpiError(409, "period_closed");
  } else {
    const couldOpen = mayChange(actor, scopes, review, false);
    if (!couldOpen) throw new KpiError(403, "out_of_scope");
    if (!mayChange(actor, scopes, review, closed)) throw new KpiError(409, "period_closed");
    // Строка оценки уже под FOR UPDATE, а openDispute блокирует её же: спор не появится до конца транзакции.
    if (await hasOpenDispute(tx, "review", review.id)) throw new KpiError(409, "open_dispute");
  }

  const settings = await loadSettings(tx);
  if (!commentOk(comment, settings.change_comment_min)) {
    throw new KpiError(422, "comment_required", { min: settings.change_comment_min });
  }

  const before = await reviewRows(tx, review.id);
  // Предложения по снимку: живые данные Workly на отправленную оценку не влияют.
  const suggestions = await loadSuggestions(
    tx,
    { employee_id: review.employee_id, period: review.period, status: "submitted" },
    before
  );
  const after = applyInputs(before, items, suggestions);

  const oldScores = Object.fromEntries(before.map((i) => [i.item_id, i.score]));
  const newScores = Object.fromEntries(after.map((i) => [i.item_id, i.score]));
  const titles = new Map(before.map((i) => [i.item_id, i.title_ru]));
  const changes = diffScores(oldScores, newScores).map((c) => ({ ...c, title_ru: titles.get(c.item_id) ?? "" }));
  const noteChanged = after.filter((a, idx) => a.note !== before[idx].note);
  if (changes.length === 0 && noteChanged.length === 0) throw new KpiError(422, "no_changes");

  const missing = missingManual(after.map((i) => ({ item_id: i.item_id, weight: i.weight, source: i.source, score: i.score })));
  if (missing.length) throw new KpiError(422, "missing_items", { items: missing });
  checkNoDataNotes(after, suggestions);

  const oldPct = pctNum(review.score_pct);
  const newPct = pctOf(after);
  const version = review.version + 1;
  const text = comment.trim();
  for (const a of after) {
    await tx
      .update(kpi_review_items)
      .set({ score: a.score, note: a.note })
      .where(and(eq(kpi_review_items.review_id, review.id), eq(kpi_review_items.item_id, a.item_id)));
  }
  await tx
    .update(kpi_reviews)
    .set({ score_pct: pctStr(newPct), version, updated_at: now().toISOString() })
    .where(eq(kpi_reviews.id, review.id));
  await tx.insert(kpi_review_events).values({
    review_id: review.id,
    actor_kind: "user",
    actor_user_id: actor.userId,
    kind: kind ?? (closed ? "hr_adjusted" : "changed"),
    changes,
    old_score_pct: pctStr(oldPct),
    new_score_pct: pctStr(newPct),
    comment: text,
  });
  await enqueue(tx, {
    recipient_kind: "employee",
    employee_id: review.employee_id,
    kind: "review_changed",
    payload: { period, review_id: review.id, score_pct: newPct, version, changes, comment: text },
    dedupe_key: `review_changed:${review.id}:${version}`,
  });
  const emp = await loadEmployee(tx, review.employee_id);
  const fresh = await loadReview(tx, review.id);
  return buildForm(tx, actor, scopes, emp, period, fresh);
}

export async function changeReview(
  db: DbLike,
  actor: Actor,
  reviewId: string,
  items: ItemInput[],
  comment: string,
  kind?: "changed" | "hr_adjusted"
): Promise<ReviewForm> {
  return inTx(db, (tx) => changeReviewTx(tx, actor, reviewId, items, comment, kind));
}

export async function reviewEvents(db: DbLike, actor: Actor, reviewId: string): Promise<ReviewEvent[]> {
  const review = await loadReview(db, reviewId);
  const scopes = await scopesOf(db, actor);
  const [emp] = await loadDirectory(db, { employeeIds: [review.employee_id], includeInactive: true });
  const visible = canSeeEither(
    actor,
    scopes,
    emp ? { terminal_id: emp.terminal_id, card_id: emp.card_id } : null,
    { terminal_id: review.terminal_id, card_id: review.card_id }
  );
  if (!visible) throw new KpiError(403, "out_of_scope");
  const rows = await db
    .select()
    .from(kpi_review_events)
    .where(eq(kpi_review_events.review_id, review.id))
    .orderBy(asc(kpi_review_events.created_at), asc(kpi_review_events.id));
  const names = await userNames(db, rows.map((r) => r.actor_user_id).filter((x): x is string => !!x));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actor_kind: r.actor_kind,
    actor_name: r.actor_user_id ? (names.get(r.actor_user_id) ?? null) : null,
    changes: r.changes as ReviewEvent["changes"],
    old_score_pct: pctNum(r.old_score_pct),
    new_score_pct: pctNum(r.new_score_pct),
    comment: r.comment,
    created_at: iso(r.created_at),
  }));
}

export async function listReviews(
  db: DbLike,
  actor: Actor,
  q: { period: string } & Omit<EmployeeQuery, "period">
): Promise<EmployeeRow[]> {
  return listEmployeeRows(db, actor, q, { onlyWithReview: true });
}
