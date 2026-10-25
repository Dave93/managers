// Споры по оценкам и нарушениям: открытие, разбор, список.
import type { DrizzleDB } from "@backend/lib/db";
import { kpi_disputes, kpi_review_events, kpi_reviews, kpi_violations } from "backend/drizzle/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { has, loadScopes, parsePeriod, seesNetwork, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { canEvaluate, canSeeEither, loadDirectory, terminalNames, userNames, type DirEmployee } from "./directory";
import { UUID_RE } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { enqueue } from "./notify";
import { lockPeriodShared } from "./periods";
import { changeReviewTx, type ItemInput } from "./reviews";
import { commentOk, type Scope } from "./rules";
import { loadSettings } from "./settings";
import { disputeDeadline } from "./time";
import type { DisputeRow } from "./types";
import { cancelViolationTx } from "./violations";

type DRow = typeof kpi_disputes.$inferSelect;
type RRow = typeof kpi_reviews.$inferSelect;
type VRow = typeof kpi_violations.$inferSelect;
type Subject = { terminal_id: string; card_id: string | null };

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

// Нарушение уникального индекса: код может лежать и в самой ошибке, и в cause.
const isUniqueViolation = (e: any): boolean => e?.code === "23505" || e?.cause?.code === "23505";

// Право открывать и разбирать спор: kpi.approve или оценщик с назначением,
// покрывающим сотрудника сейчас или по снимку записи.
function mayHandle(actor: Actor, scopes: Scope[], emp: DirEmployee | undefined, snapshot: Subject | null): boolean {
  if (has(actor, "kpi.approve")) return true;
  if (emp && canEvaluate(actor, scopes, { terminal_id: emp.terminal_id, card_id: emp.card_id })) return true;
  return snapshot !== null && canEvaluate(actor, scopes, snapshot);
}

type Loaded = {
  reviews: Map<string, RRow>;
  violations: Map<string, VRow>;
  emps: Map<string, DirEmployee>;
};

// Объекты споров и сотрудники одним пакетом запросов.
async function loadSubjects(db: DbLike, rows: DRow[]): Promise<Loaded> {
  const rIds = rows.filter((r) => r.subject_type === "review").map((r) => r.subject_id);
  const vIds = rows.filter((r) => r.subject_type === "violation").map((r) => r.subject_id);
  const reviews = new Map<string, RRow>();
  const violations = new Map<string, VRow>();
  if (rIds.length) {
    for (const r of await db.select().from(kpi_reviews).where(inArray(kpi_reviews.id, rIds))) reviews.set(r.id, r);
  }
  if (vIds.length) {
    for (const v of await db.select().from(kpi_violations).where(inArray(kpi_violations.id, vIds))) violations.set(v.id, v);
  }
  const empIds = [...new Set(rows.map((r) => r.employee_id).filter((x): x is string => !!x))];
  const dir = await loadDirectory(db, { employeeIds: empIds, includeInactive: true });
  return { reviews, violations, emps: new Map(dir.map((e) => [e.id, e])) };
}

// Филиал и карта записи на момент события; у нарушения карты нет, берём текущую карту сотрудника.
function snapshotOf(d: DRow, l: Loaded): Subject | null {
  if (d.subject_type === "review") {
    const r = l.reviews.get(d.subject_id);
    return r ? { terminal_id: r.terminal_id, card_id: r.card_id } : null;
  }
  if (d.subject_type === "violation") {
    const v = l.violations.get(d.subject_id);
    return v ? { terminal_id: v.terminal_id, card_id: l.emps.get(v.employee_id)?.card_id ?? null } : null;
  }
  return null;
}

function canHandle(actor: Actor, scopes: Scope[], d: DRow, l: Loaded): boolean {
  return mayHandle(actor, scopes, d.employee_id ? l.emps.get(d.employee_id) : undefined, snapshotOf(d, l));
}

async function toRows(db: DbLike, actor: Actor | null, rows: DRow[], l?: Loaded): Promise<DisputeRow[]> {
  if (rows.length === 0) return [];
  const loaded = l ?? (await loadSubjects(db, rows));
  const scopes = actor ? await loadScopes(db, actor.userId) : [];
  const names = await userNames(db, rows.map((r) => r.resolved_by).filter((x): x is string => !!x));
  const snaps = rows.map((r) => snapshotOf(r, loaded));
  const tNames = await terminalNames(db, snaps.filter((s): s is Subject => s !== null).map((s) => s.terminal_id));
  return rows.map((r, i) => {
    const emp = r.employee_id ? loaded.emps.get(r.employee_id) : undefined;
    const snap = snaps[i];
    return {
      id: r.id,
      subject_type: r.subject_type as "review" | "violation",
      subject_id: r.subject_id,
      employee_id: r.employee_id,
      employee_name: emp ? `${emp.last_name} ${emp.first_name}`.trim() : null,
      terminal_name: snap ? (tNames.get(snap.terminal_id) ?? null) : null,
      period: r.period,
      opened_via: r.opened_via as "admin" | "telegram",
      reason: r.reason,
      status: r.status as "open" | "accepted" | "rejected",
      resolution_comment: r.resolution_comment,
      resolved_by_name: r.resolved_by ? (names.get(r.resolved_by) ?? null) : null,
      resolved_at: iso(r.resolved_at),
      created_at: iso(r.created_at),
      can_resolve: actor !== null && r.status === "open" && canHandle(actor, scopes, r, loaded),
    };
  });
}

export async function openDispute(
  db: DbLike,
  actor: Actor | null,
  input: {
    subject_type: "review" | "violation";
    subject_id: string;
    reason: string;
    via?: "admin" | "telegram";
    employee_actor?: boolean;
  }
): Promise<DisputeRow> {
  const { subject_type, subject_id } = input;
  if (subject_type !== "review" && subject_type !== "violation") throw new KpiError(422, "bad_subject_type");
  const via = input.via ?? "admin";
  if (via !== "admin" && via !== "telegram") throw new KpiError(422, "bad_via");
  if (typeof subject_id !== "string" || !UUID_RE.test(subject_id)) throw new KpiError(404, "not_found");
  // Без пользователя можно только от имени сотрудника.
  if (!input.employee_actor && !actor) throw new KpiError(401, "unauthorized");

  return inTx(db, async (tx) => {
    // Строку объекта блокируем: состояние и права проверяются на одном и том же снимке.
    let employee_id: string;
    let period: string;
    let notifyUser: string;
    let snapshot: Subject;
    let stateError: KpiError | null = null;
    if (subject_type === "review") {
      const [r] = await tx.select().from(kpi_reviews).where(eq(kpi_reviews.id, subject_id)).for("update");
      if (!r) throw new KpiError(404, "not_found");
      employee_id = r.employee_id;
      period = r.period;
      notifyUser = r.evaluator_user_id;
      snapshot = { terminal_id: r.terminal_id, card_id: r.card_id };
      if (r.status !== "submitted") stateError = new KpiError(409, "not_submitted");
    } else {
      const [v] = await tx.select().from(kpi_violations).where(eq(kpi_violations.id, subject_id)).for("update");
      if (!v) throw new KpiError(404, "not_found");
      employee_id = v.employee_id;
      period = v.period;
      notifyUser = v.recorded_by;
      const [e] = await loadDirectory(tx, { employeeIds: [employee_id], includeInactive: true });
      snapshot = { terminal_id: v.terminal_id, card_id: e?.card_id ?? null };
      if (v.status !== "active") stateError = new KpiError(409, "already_cancelled");
    }

    if (!input.employee_actor) {
      const scopes = await loadScopes(tx, actor!.userId);
      const [emp] = await loadDirectory(tx, { employeeIds: [employee_id], includeInactive: true });
      if (!mayHandle(actor!, scopes, emp, snapshot)) throw new KpiError(403, "out_of_scope");
    }

    const settings = await loadSettings(tx);
    if (!commentOk(input.reason, settings.change_comment_min)) {
      throw new KpiError(422, "comment_required", { min: settings.change_comment_min });
    }
    if (stateError) throw stateError;
    if (now().getTime() > disputeDeadline(period, settings.dispute_deadline_day).getTime()) {
      throw new KpiError(409, "dispute_window_closed");
    }
    // Строка месяца блокируется после предмета спора, как у всех пишущих (цикла нет):
    // закрытие месяца не проскочит между проверкой и вставкой спора.
    if (await lockPeriodShared(tx, period)) throw new KpiError(409, "period_closed");

    const reason = input.reason.trim();
    let row: DRow;
    try {
      [row] = await tx
        .insert(kpi_disputes)
        .values({
          subject_type,
          subject_id,
          employee_id,
          period,
          opened_via: via,
          opened_by_user_id: input.employee_actor ? null : actor!.userId,
          reason,
        })
        .returning();
    } catch (e) {
      // Частичный unique: второй открытый спор по тому же объекту.
      if (isUniqueViolation(e)) throw new KpiError(409, "dispute_exists");
      throw e;
    }
    if (subject_type === "review") {
      await tx.insert(kpi_review_events).values({
        review_id: subject_id,
        actor_kind: input.employee_actor ? "employee" : "user",
        actor_user_id: input.employee_actor ? null : actor!.userId,
        kind: "dispute_opened",
        changes: [],
        old_score_pct: null,
        new_score_pct: null,
        comment: reason,
        // Время начала транзакции у событий одной транзакции совпадает; порядок задаём часами.
        created_at: sql`clock_timestamp()`,
      });
    }
    const [who] = await loadDirectory(tx, { employeeIds: [employee_id], includeInactive: true });
    await enqueue(tx, {
      recipient_kind: "user",
      user_id: notifyUser,
      kind: "dispute_opened",
      payload: {
        dispute_id: row.id,
        subject_type,
        subject_id,
        employee_id,
        period,
        employee_name: who ? `${who.first_name} ${who.last_name}`.trim() : "",
        reason,
      },
      dedupe_key: `dispute_opened:${row.id}`,
    });
    return (await toRows(tx, actor, [row]))[0];
  });
}

export async function resolveDispute(
  db: DbLike,
  actor: Actor,
  id: string,
  input: { decision: "accepted" | "rejected"; comment: string; items?: ItemInput[] }
): Promise<DisputeRow> {
  if (!UUID_RE.test(id)) throw new KpiError(404, "not_found");
  if (input.decision !== "accepted" && input.decision !== "rejected") throw new KpiError(422, "bad_decision");
  return inTx(db, async (tx) => {
    const [d] = await tx.select().from(kpi_disputes).where(eq(kpi_disputes.id, id)).for("update");
    if (!d) throw new KpiError(404, "not_found");
    const l = await loadSubjects(tx, [d]);
    const scopes = await loadScopes(tx, actor.userId);
    if (!canHandle(actor, scopes, d, l)) throw new KpiError(403, "out_of_scope");

    const settings = await loadSettings(tx);
    if (!commentOk(input.comment, settings.change_comment_min)) {
      throw new KpiError(422, "comment_required", { min: settings.change_comment_min });
    }
    if (d.status !== "open") throw new KpiError(409, "dispute_closed");
    const comment = input.comment.trim();
    let newScorePct: number | null = null;

    if (input.decision === "accepted") {
      if (d.subject_type === "review") {
        if (!input.items || input.items.length === 0) throw new KpiError(422, "items_required");
        // Оценка меняется в этой же транзакции: либо всё сразу, либо ничего.
        await changeReviewTx(tx, actor, d.subject_id, input.items, comment, undefined, { rightsChecked: true });
        const [rv] = await tx
          .select({ score_pct: kpi_reviews.score_pct })
          .from(kpi_reviews)
          .where(eq(kpi_reviews.id, d.subject_id));
        newScorePct = rv?.score_pct == null ? null : Number(rv.score_pct);
      } else if (d.subject_type === "violation") {
        await cancelViolationTx(tx, d.subject_id, comment, actor.userId);
      }
    }
    if (d.subject_type === "review") {
      await tx.insert(kpi_review_events).values({
        review_id: d.subject_id,
        actor_kind: "user",
        actor_user_id: actor.userId,
        kind: "dispute_resolved",
        changes: [],
        old_score_pct: null,
        new_score_pct: null,
        comment,
        created_at: sql`clock_timestamp()`,
      });
    }
    const [row] = await tx
      .update(kpi_disputes)
      .set({
        status: input.decision,
        resolution_comment: comment,
        resolved_by: actor.userId,
        resolved_at: now().toISOString(),
      })
      .where(and(eq(kpi_disputes.id, d.id), eq(kpi_disputes.status, "open")))
      .returning();
    if (!row) throw new KpiError(409, "dispute_closed");
    if (d.employee_id) {
      await enqueue(tx, {
        recipient_kind: "employee",
        employee_id: d.employee_id,
        kind: "dispute_resolved",
        payload: {
          dispute_id: d.id,
          subject_type: d.subject_type,
          subject_id: d.subject_id,
          decision: input.decision,
          comment,
          period: d.period,
          ...(newScorePct === null ? {} : { score_pct: newScorePct }),
        },
        dedupe_key: `dispute_resolved:${d.id}`,
      });
    }
    return (await toRows(tx, actor, [row]))[0];
  });
}

export async function listDisputes(
  db: DbLike,
  actor: Actor,
  q: { status?: string; period?: string }
): Promise<DisputeRow[]> {
  const conds = [];
  if (q.status !== undefined) {
    if (q.status !== "open" && q.status !== "accepted" && q.status !== "rejected") throw new KpiError(422, "bad_status");
    conds.push(eq(kpi_disputes.status, q.status));
  }
  if (q.period !== undefined) conds.push(eq(kpi_disputes.period, parsePeriod(q.period)));
  const rows = await db
    .select()
    .from(kpi_disputes)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(kpi_disputes.created_at), kpi_disputes.id);
  const l = await loadSubjects(db, rows);
  let shown = rows;
  if (!seesNetwork(actor)) {
    const scopes = await loadScopes(db, actor.userId);
    shown = rows.filter((r) => {
      const emp = r.employee_id ? l.emps.get(r.employee_id) : undefined;
      return canSeeEither(
        actor,
        scopes,
        emp ? { terminal_id: emp.terminal_id, card_id: emp.card_id } : null,
        snapshotOf(r, l)
      );
    });
  }
  return toRows(db, actor, shown.slice(0, 500), l);
}
