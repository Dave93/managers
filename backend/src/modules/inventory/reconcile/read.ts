// Запросы экранов сверки (spec 2026-10-06, §6–7).
import {
  corporation_store,
  inventory_counts,
  inventory_reconciliation_events,
  inventory_reconciliation_line_marks,
  inventory_reconciliation_lines,
  inventory_reconciliations,
} from "backend/drizzle/schema";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { userNames } from "../counts";
import { InventoryError } from "../errors";
import { UUID_RE } from "../rules";
import type {
  ReconAdminState,
  ReconBranchEdit,
  ReconCandidate,
  ReconDetail,
  ReconLine,
  ReconOverviewRow,
  ReconStatus,
  ReconTotals,
} from "./types";

type ReconRow = typeof inventory_reconciliations.$inferSelect;

// Сколько раз отправленные пересчёты склада за период возвращали в черновик.
const REOPEN_COUNT_SQL = sql<number>`(
  select count(*)::int from inventory_count_events e join inventory_counts c on c.id = e.count_id
  where e.type = 'reopened' and c.store_id = "inventory_reconciliations"."store_id"
    and c.period = "inventory_reconciliations"."period")`;

// Живое состояние пересчётов админки за период, не снимок этапа 2.
const ADMIN_STATE_SQL = sql<ReconAdminState>`(
  select case when bool_or(c.status = 'submitted') then 'submitted' when count(*) > 0 then 'draft' else 'none' end
  from inventory_counts c
  where c.store_id = "inventory_reconciliations"."store_id" and c.period = "inventory_reconciliations"."period"
    and c.status <> 'cancelled')`;

function overviewRow(r: ReconRow, storeName: string | null, adminState: ReconAdminState, reopenCount: number): ReconOverviewRow {
  return {
    id: r.id,
    store_id: r.store_id,
    store_name: storeName ?? "",
    organization_id: r.organization_id,
    period: r.period,
    status: r.status as ReconStatus,
    admin_state: adminState,
    reopen_count: reopenCount,
    iiko_document_num: r.iiko_document_num,
    iiko_document_comment: r.iiko_document_comment,
    iiko_doc_state: r.iiko_doc_state as ReconOverviewRow["iiko_doc_state"],
    changed_after_accept: r.changed_after_accept,
    fetched_at: r.fetched_at,
    calculated_at: r.calculated_at,
    lines_total: r.lines_total,
    mismatch_ab_count: r.mismatch_ab_count,
    diff_ab_sum: r.diff_ab_sum,
    diff_ac_sum: r.diff_ac_sum,
    diff_bc_sum: r.diff_bc_sum,
  };
}

export async function listReconciliations(db: DbLike, period: string): Promise<ReconOverviewRow[]> {
  const rows = await db
    .select({ r: inventory_reconciliations, store_name: corporation_store.name, admin_state: ADMIN_STATE_SQL, reopen_count: REOPEN_COUNT_SQL })
    .from(inventory_reconciliations)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_reconciliations.store_id))
    .where(eq(inventory_reconciliations.period, period))
    .orderBy(asc(corporation_store.name));
  return rows.map((x) => overviewRow(x.r, x.store_name, x.admin_state, x.reopen_count));
}

async function getRow(db: DbLike, id: string) {
  if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
  const [x] = await db
    .select({ r: inventory_reconciliations, store_name: corporation_store.name, admin_state: ADMIN_STATE_SQL, reopen_count: REOPEN_COUNT_SQL })
    .from(inventory_reconciliations)
    .leftJoin(corporation_store, eq(corporation_store.id, inventory_reconciliations.store_id))
    .where(eq(inventory_reconciliations.id, id));
  if (!x) throw new InventoryError(404, "not_found");
  return x;
}

export async function reconTarget(db: DbLike, id: string) {
  const { r } = await getRow(db, id);
  return { store_id: r.store_id, period: r.period };
}

async function branchEdits(db: DbLike, countIds: string[]): Promise<ReconBranchEdit[]> {
  if (!countIds.length) return [];
  const ids = sql.join(countIds.map((id) => sql`${id}::uuid`), sql`, `);
  const res = await db.execute(sql`
    with firsts as (
      select count_id, min(created_at) as at from inventory_count_events
      where type = 'submitted' and count_id in (${ids}) group by count_id)
    select e.created_at as at, 'entry_added' as kind, e.created_by as user_id, e.count_id, l.product_name, e.qty::text as qty
      from inventory_count_entries e join inventory_count_lines l on l.id = e.line_id join firsts f on f.count_id = e.count_id
      where e.created_at > f.at
    union all
    select e.deleted_at, 'entry_deleted', e.deleted_by, e.count_id, l.product_name, e.qty::text
      from inventory_count_entries e join inventory_count_lines l on l.id = e.line_id join firsts f on f.count_id = e.count_id
      where e.deleted_at > f.at
    union all
    select ev.created_at, ev.type, ev.user_id, ev.count_id, null, null
      from inventory_count_events ev where ev.type = 'reopened' and ev.count_id in (${ids})
    order by 1`);
  const rows = res.rows as { at: string | Date; kind: ReconBranchEdit["kind"]; user_id: string | null; count_id: string; product_name: string | null; qty: string | null }[];
  const names = await userNames(db, rows.map((r) => r.user_id ?? ""));
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    user_name: r.user_id ? names.get(r.user_id) ?? "—" : "—",
    count_id: r.count_id,
    product_name: r.product_name,
    qty: r.qty,
  }));
}

export async function loadReconciliation(db: DbLike, id: string, now: Date): Promise<ReconDetail> {
  const { r, store_name, admin_state, reopen_count } = await getRow(db, id);
  const l = inventory_reconciliation_lines;
  const lines = await db
    .select({
      product_id: l.product_id,
      product_name: l.product_name,
      unit_name: l.unit_name,
      group_name: l.group_name,
      admin_state: l.admin_state,
      admin_qty: l.admin_qty,
      admin_counts_n: l.admin_counts_n,
      book_qty: l.book_qty,
      iiko_correction_qty: l.iiko_correction_qty,
      iiko_correction_sum: l.iiko_correction_sum,
      iiko_fact_qty: l.iiko_fact_qty,
      unit_cost: l.unit_cost,
      cost_source: l.cost_source,
      diff_ab_qty: l.diff_ab_qty,
      diff_ab_sum: l.diff_ab_sum,
      diff_ac_sum: l.diff_ac_sum,
      checked_by: inventory_reconciliation_line_marks.checked_by,
      checked_at: inventory_reconciliation_line_marks.checked_at,
    })
    .from(l)
    .leftJoin(
      inventory_reconciliation_line_marks,
      and(
        eq(inventory_reconciliation_line_marks.reconciliation_id, l.reconciliation_id),
        eq(inventory_reconciliation_line_marks.product_id, l.product_id)
      )
    )
    .where(eq(l.reconciliation_id, id))
    .orderBy(asc(l.group_name), asc(l.product_name));

  const ev = inventory_reconciliation_events;
  const events = await db.select().from(ev).where(eq(ev.reconciliation_id, id)).orderBy(asc(ev.created_at));
  const counts = await db
    .select({
      id: inventory_counts.id,
      template_name: inventory_counts.template_name,
      status: inventory_counts.status,
    })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, r.store_id), eq(inventory_counts.period, r.period), ne(inventory_counts.status, "cancelled")))
    .orderBy(asc(inventory_counts.created_at));
  const names = await userNames(db, [...events.map((e) => e.user_id ?? ""), r.reviewed_by ?? "", ...lines.map((x) => x.checked_by ?? "")]);

  return {
    ...overviewRow(r, store_name, admin_state, reopen_count),
    iiko_document_id: r.iiko_document_id,
    iiko_document_at: r.iiko_document_at,
    book_at: r.book_at,
    iiko_candidates: (r.iiko_candidates as ReconCandidate[] | null) ?? null,
    review_comment: r.review_comment,
    reviewed_by_name: r.reviewed_by ? names.get(r.reviewed_by) ?? "—" : null,
    reviewed_at: r.reviewed_at,
    accepted_totals: (r.accepted_totals as ReconTotals | null) ?? null,
    counts,
    lines: lines.map(({ checked_by, ...x }) => ({
      ...x,
      admin_state: x.admin_state as ReconLine["admin_state"],
      cost_source: x.cost_source as ReconLine["cost_source"],
      checked: checked_by !== null,
      checked_by_name: checked_by ? names.get(checked_by) ?? "—" : null,
      checked_at: x.checked_at,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      user_name: e.user_id ? names.get(e.user_id) ?? "—" : null,
      payload: e.payload,
      created_at: e.created_at,
    })),
    branch_edits: await branchEdits(db, counts.map((c) => c.id)),
  };
}

export async function chooseDocument(db: DbLike, id: string, documentId: string, userId: string) {
  return db.transaction(async (tx) => {
    if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
    const [row] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, id)).for("update");
    if (!row) throw new InventoryError(404, "not_found");
    const cand = ((row.iiko_candidates as ReconCandidate[] | null) ?? []).find((c) => c.id === documentId);
    if (!cand) throw new InventoryError(422, "not_a_candidate");
    await tx
      .update(inventory_reconciliations)
      .set({ iiko_document_id: documentId, updated_at: sql`now()` })
      .where(eq(inventory_reconciliations.id, id));
    await tx.insert(inventory_reconciliation_events).values({
      reconciliation_id: id,
      type: "doc_chosen",
      user_id: userId,
      payload: { document_id: documentId, num: cand.num },
    });
    return { store_id: row.store_id, period: row.period };
  });
}

const TRANSITIONS: Record<string, ("in_review" | "accepted")[]> = {
  ready: ["in_review", "accepted"],
  in_review: ["in_review", "accepted"],
  accepted: ["in_review"],
};

export async function setReconStatus(
  db: DbLike,
  id: string,
  status: "in_review" | "accepted",
  comment: string | null,
  userId: string
) {
  return db.transaction(async (tx) => {
    if (!UUID_RE.test(id)) throw new InventoryError(404, "not_found");
    const [row] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, id)).for("update");
    if (!row) throw new InventoryError(404, "not_found");
    if (!(TRANSITIONS[row.status] ?? []).includes(status)) throw new InventoryError(409, "not_ready", { status: row.status });
    const text = comment?.trim() || null;
    if (status === "in_review" && !text) throw new InventoryError(422, "comment_required");
    const totals: ReconTotals = {
      lines_total: row.lines_total,
      mismatch_ab_count: row.mismatch_ab_count,
      diff_ab_sum: row.diff_ab_sum,
      diff_ac_sum: row.diff_ac_sum,
      diff_bc_sum: row.diff_bc_sum,
    };
    await tx
      .update(inventory_reconciliations)
      .set({
        status,
        review_comment: text ?? row.review_comment,
        reviewed_by: userId,
        reviewed_at: sql`now()`,
        updated_at: sql`now()`,
        ...(status === "accepted" ? { accepted_totals: totals, changed_after_accept: false } : {}),
      })
      .where(eq(inventory_reconciliations.id, id));
    await tx.insert(inventory_reconciliation_events).values({
      reconciliation_id: id,
      type: "status_changed",
      user_id: userId,
      payload: { from: row.status, to: status, comment: text },
    });
    return { ok: true as const };
  });
}

/** Отметка «проверено» по строке сверки (товару). Повторная отметка не меняет автора и время. */
export async function setLineMark(db: DbLike, id: string, productId: string, checked: boolean, userId: string) {
  if (!UUID_RE.test(id) || !UUID_RE.test(productId)) throw new InventoryError(404, "not_found");
  const [line] = await db
    .select({ product_id: inventory_reconciliation_lines.product_id })
    .from(inventory_reconciliation_lines)
    .where(and(eq(inventory_reconciliation_lines.reconciliation_id, id), eq(inventory_reconciliation_lines.product_id, productId)));
  if (!line) throw new InventoryError(404, "line_not_found");
  const m = inventory_reconciliation_line_marks;
  if (checked) {
    await db.insert(m).values({ reconciliation_id: id, product_id: productId, checked_by: userId }).onConflictDoNothing();
  } else {
    await db.delete(m).where(and(eq(m.reconciliation_id, id), eq(m.product_id, productId)));
  }
  return { ok: true as const };
}

