import type { DrizzleDB } from "@backend/lib/db";
import { kpi_disputes, kpi_evaluator_scopes, kpi_periods } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { has, seesNetwork, type Actor, type DbLike } from "./access";
import { now } from "./clock";
import { userNames } from "./directory";
import { listEmployeeRows } from "./employees";
import { KpiError } from "./errors";
import { iso } from "./iso";
import { commentOk, scopeCovers } from "./rules";
import { loadSettings } from "./settings";
import { disputeDeadline, reviewDeadline, submitOpensAt, type Period } from "./time";
import type { Deadlines, EmployeeRow, PeriodSummary } from "./types";

// Месяц закрыт, если есть строка kpi_periods со статусом closed.
export async function isPeriodClosed(db: DbLike, period: Period): Promise<boolean> {
  const rows = await db
    .select({ period: kpi_periods.period })
    .from(kpi_periods)
    .where(and(eq(kpi_periods.period, period), eq(kpi_periods.status, "closed")))
    .limit(1);
  return rows.length > 0;
}

// Для записи внутри транзакции: строка месяца под FOR SHARE до конца транзакции.
// Закрытие и открытие берут её FOR UPDATE, поэтому ждут пишущих, а пишущие — их.
// Порядок блокировок как у openDispute: сначала предмет записи, потом месяц.
export async function lockPeriodShared(tx: DbLike, period: Period): Promise<boolean /* closed */> {
  await tx.insert(kpi_periods).values({ period, status: "open" }).onConflictDoNothing({ target: kpi_periods.period });
  const [row] = await tx
    .select({ status: kpi_periods.status })
    .from(kpi_periods)
    .where(eq(kpi_periods.period, period))
    .for("share");
  return row?.status === "closed";
}

export function deadlinesOf(
  period: Period,
  s: { review_deadline_day: number; dispute_deadline_day: number }
): Deadlines {
  return {
    period,
    submit_opens_at: submitOpensAt(period).toISOString(),
    review_deadline: reviewDeadline(period, s.review_deadline_day).toISOString(),
    dispute_deadline: disputeDeadline(period, s.dispute_deadline_day).toISOString(),
  };
}

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

// Сводка видит всю сеть: нужна для «кто отстаёт», где права смотрящего не важны.
const NETWORK_VIEW: Actor = { userId: "00000000-0000-0000-0000-000000000000", perms: new Set(["kpi.approve"]), isHq: false, terminals: [] };

async function openDisputes(db: DbLike, period: Period) {
  return db
    .select({ id: kpi_disputes.id, employee_id: kpi_disputes.employee_id })
    .from(kpi_disputes)
    .where(and(eq(kpi_disputes.period, period), eq(kpi_disputes.status, "open")));
}

// Коды причин, почему закрыть нельзя, в порядке проверки.
async function blockersOf(
  db: DbLike,
  period: Period,
  dispute_day: number
): Promise<{ blockers: string[]; open_ids: string[] }> {
  const blockers: string[] = [];
  const settings = { dispute_deadline_day: dispute_day };
  if (now().getTime() <= disputeDeadline(period, settings.dispute_deadline_day).getTime()) {
    blockers.push("dispute_window_open");
  }
  const open = await openDisputes(db, period);
  if (open.length > 0) blockers.push("open_disputes");
  if (await isPeriodClosed(db, period)) blockers.push("already_closed");
  return { blockers, open_ids: open.map((o) => o.id) };
}

export type Lagging = { user_id: string; user_name: string; pending: number };

// Отстающие: у каждого оценщика с назначениями считаем покрытых сотрудников без отправленной оценки.
// Без rows сеть грузится здесь; сводка периода передаёт уже загруженную.
export async function laggingEvaluators(db: DbLike, period: Period, rows?: EmployeeRow[]): Promise<Lagging[]> {
  return (await evaluatorCoverage(db, period, rows)).lagging;
}

// unassigned — сотрудники без отправленной оценки, которых не покрывает ни одно назначение:
// их некому оценить, и в списке отстающих оценщиков они не видны.
async function evaluatorCoverage(
  db: DbLike,
  period: Period,
  rows?: EmployeeRow[]
): Promise<{ lagging: Lagging[]; unassigned: number }> {
  const netRows = rows ?? (await listEmployeeRows(db, NETWORK_VIEW, { period }));
  const scopeRows = await db
    .select({
      user_id: kpi_evaluator_scopes.user_id,
      card_id: kpi_evaluator_scopes.card_id,
      terminal_id: kpi_evaluator_scopes.terminal_id,
    })
    .from(kpi_evaluator_scopes);
  const byUser = new Map<string, { card_id: string | null; terminal_id: string | null }[]>();
  for (const s of scopeRows) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  const pendingRows = netRows.filter((r) => r.active && r.card !== null && r.review?.status !== "submitted");
  const found: { user_id: string; pending: number }[] = [];
  for (const [user_id, scopes] of byUser) {
    const pending = pendingRows.filter((r) =>
      scopeCovers(scopes, { terminal_id: r.terminal_id, card_id: r.card!.id })
    ).length;
    if (pending > 0) found.push({ user_id, pending });
  }
  const unassigned = pendingRows.filter(
    (r) => !scopeCovers(scopeRows, { terminal_id: r.terminal_id, card_id: r.card!.id })
  ).length;
  const names = await userNames(db, found.map((f) => f.user_id));
  const lagging = found
    .map((f) => ({ ...f, user_name: names.get(f.user_id) ?? f.user_id }))
    .sort((a, b) => b.pending - a.pending || a.user_name.localeCompare(b.user_name, "ru") || a.user_id.localeCompare(b.user_id));
  return { lagging, unassigned };
}

export async function periodSummary(db: DbLike, actor: Actor, period: Period): Promise<PeriodSummary> {
  const settings = await loadSettings(db);
  const [pRow] = await db.select().from(kpi_periods).where(eq(kpi_periods.period, period)).limit(1);
  const closed = pRow?.status === "closed";
  const closedByName =
    closed && pRow.closed_by ? ((await userNames(db, [pRow.closed_by])).get(pRow.closed_by) ?? null) : null;

  // Счётчики по тем, кого actor видит; сеть целиком у HR и головного офиса.
  const network = seesNetwork(actor);
  const netRows = await listEmployeeRows(db, NETWORK_VIEW, { period });
  const rows = network ? netRows : await listEmployeeRows(db, actor, { period });
  const nowMs = now().getTime();
  const deadlineMs = reviewDeadline(period, settings.review_deadline_day).getTime();
  const counts = { employees: rows.length, submitted: 0, drafts: 0, none: 0, late: 0, open_disputes: 0 };
  for (const r of rows) {
    if (r.review?.status === "submitted") {
      counts.submitted++;
      if (r.review.late) counts.late++;
    } else {
      if (r.review?.status === "draft") counts.drafts++;
      else counts.none++;
      if (nowMs > deadlineMs) counts.late++;
    }
  }
  const open = await openDisputes(db, period);
  const visibleIds = new Set(rows.map((r) => r.id));
  counts.open_disputes = network ? open.length : open.filter((o) => o.employee_id && visibleIds.has(o.employee_id)).length;

  // Отстающие: у каждого оценщика с назначениями считаем покрытых сотрудников без отправленной оценки.
  let lagging: PeriodSummary["lagging"] = [];
  let unassigned = 0;
  if (has(actor, "kpi.approve") || has(actor, "kpi.manage")) {
    ({ lagging, unassigned } = await evaluatorCoverage(db, period, netRows));
  }

  const { blockers } = await blockersOf(db, period, settings.dispute_deadline_day);
  return {
    period,
    status: closed ? "closed" : "open",
    closed_at: closed ? iso(pRow.closed_at) : null,
    closed_by_name: closedByName,
    deadlines: deadlinesOf(period, settings),
    counts,
    lagging,
    unassigned,
    can_close: blockers.length === 0,
    close_blockers: blockers,
  };
}

export async function closePeriod(db: DbLike, actor: Actor, period: Period): Promise<PeriodSummary> {
  return inTx(db, async (tx) => {
    const settings = await loadSettings(tx);
    // Строка месяца нужна для блокировки: два закрытия подряд не проходят одновременно.
    await tx.insert(kpi_periods).values({ period, status: "open" }).onConflictDoNothing({ target: kpi_periods.period });
    await tx.select().from(kpi_periods).where(eq(kpi_periods.period, period)).for("update");
    const { blockers, open_ids } = await blockersOf(tx, period, settings.dispute_deadline_day);
    if (blockers.includes("dispute_window_open")) throw new KpiError(409, "dispute_window_open");
    if (blockers.includes("open_disputes")) throw new KpiError(409, "open_disputes", { ids: open_ids });
    if (blockers.includes("already_closed")) throw new KpiError(409, "already_closed");
    await tx
      .update(kpi_periods)
      .set({ status: "closed", closed_by: actor.userId, closed_at: now().toISOString() })
      .where(eq(kpi_periods.period, period));
    return periodSummary(tx, actor, period);
  });
}

export async function reopenPeriod(db: DbLike, actor: Actor, period: Period, comment: string): Promise<PeriodSummary> {
  if (!commentOk(comment, 1)) throw new KpiError(422, "comment_required");
  return inTx(db, async (tx) => {
    const [row] = await tx.select().from(kpi_periods).where(eq(kpi_periods.period, period)).for("update");
    if (!row || row.status !== "closed") throw new KpiError(409, "not_closed");
    await tx
      .update(kpi_periods)
      .set({ status: "open", reopen_comment: comment.trim() })
      .where(eq(kpi_periods.period, period));
    return periodSummary(tx, actor, period);
  });
}
