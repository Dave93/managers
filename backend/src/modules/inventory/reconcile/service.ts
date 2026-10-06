// Этапы сверки с базой (spec 2026-10-06, §5). Этап 1 — документы и корректировки
// (секунды), этап 2 — учёт и расчёт строк (около минуты). iiko подаётся снаружи,
// чтобы тесты шли без сети.
import {
  corporation_store,
  inventory_counts,
  inventory_reconciliation_events,
  inventory_reconciliation_iiko_lines,
  inventory_reconciliation_lines,
  inventory_reconciliations,
} from "backend/drizzle/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "../access";
import { GROUP_NAME_SQL } from "../counts";
import type { IikoClient } from "./iiko-client";
import {
  bookAt,
  buildLines,
  correctionsFor,
  diffCorrections,
  isMonthly,
  pickDocument,
  previousPeriods,
  sameTotals,
  toIikoTimestamp,
  totals,
  totalsToDb,
  type AdminAgg,
  type CorrLine,
  type IikoDoc,
  type ProductMeta,
} from "./pure";
import type { ReconAdminState, ReconCandidate, ReconFetchStatus, ReconTotals } from "./types";

export type RunInput = { period: string; storeId?: string | null; userId?: string | null };
export type Stage1Result = { scope: string[]; received: { store_id: string; num: string }[]; missing: string[] };
export type Progress = (patch: Partial<ReconFetchStatus>) => Promise<void>;

type ReconRow = typeof inventory_reconciliations.$inferSelect;

const uuidList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

async function writeReconEvent(tx: DbLike, reconId: string, type: string, userId: string | null | undefined, payload: unknown) {
  await tx.insert(inventory_reconciliation_events).values({ reconciliation_id: reconId, type, user_id: userId ?? null, payload });
}

/** Склады, от которых ждём сверку (spec §5, этап 1, шаг 3). */
export async function computeScope(db: DbLike, iiko: IikoClient, input: RunInput): Promise<{ scope: string[]; docs: IikoDoc[] }> {
  const docs = await iiko.inventoryDocs(input.period);
  if (input.storeId) return { scope: [input.storeId], docs: docs.filter((d) => d.store_id === input.storeId) };

  const ids = new Set<string>(docs.filter((d) => isMonthly(d.comment)).map((d) => d.store_id));
  for (const p of previousPeriods(input.period, 3)) {
    for (const d of await iiko.inventoryDocs(p)) if (isMonthly(d.comment)) ids.add(d.store_id);
  }
  const admin = await db
    .selectDistinct({ store_id: inventory_counts.store_id })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.period, input.period), inArray(inventory_counts.status, ["draft", "submitted"])));
  for (const a of admin) ids.add(a.store_id);
  if (!ids.size) return { scope: [], docs };

  // Только известные склады: без строки corporation_store нет названия и организации.
  const known = await db
    .select({ id: corporation_store.id })
    .from(corporation_store)
    .where(inArray(corporation_store.id, [...ids]));
  return { scope: known.map((k) => k.id), docs };
}

async function lockRecon(tx: DbLike, storeId: string, period: string): Promise<ReconRow> {
  const [store] = await tx
    .select({ organization_id: corporation_store.organization_id })
    .from(corporation_store)
    .where(eq(corporation_store.id, storeId));
  await tx
    .insert(inventory_reconciliations)
    .values({ store_id: storeId, period, organization_id: store?.organization_id ?? null })
    .onConflictDoNothing({ target: [inventory_reconciliations.store_id, inventory_reconciliations.period] });
  const [row] = await tx
    .select()
    .from(inventory_reconciliations)
    .where(and(eq(inventory_reconciliations.store_id, storeId), eq(inventory_reconciliations.period, period)))
    .for("update");
  return row;
}

const toCorrLine = (x: typeof inventory_reconciliation_iiko_lines.$inferSelect): CorrLine => ({
  product_id: x.product_id,
  product_name: x.product_name,
  qty: Number(x.qty),
  sum: Number(x.sum),
});

/** Этап 1: документы и корректировки. Сохраняется сразу — сигнал «данные сохранены». */
export async function runStage1(db: DbLike, iiko: IikoClient, input: RunInput): Promise<Stage1Result> {
  const { scope, docs } = await computeScope(db, iiko, input);
  const corrections = await iiko.corrections(input.period);
  const received: Stage1Result["received"] = [];
  const missing: string[] = [];

  for (const storeId of scope) {
    await db.transaction(async (tx) => {
      const row = await lockRecon(tx, storeId, input.period);
      const choice = pickDocument(docs.filter((d) => d.store_id === storeId), row.iiko_document_id);
      const base = { fetched_at: sql`now()`, fetched_by: input.userId ?? null, updated_at: sql`now()` };

      if (choice.kind === "chosen") {
        const doc = choice.doc;
        const c = correctionsFor(corrections, storeId, doc.num);
        const before = (
          await tx
            .select()
            .from(inventory_reconciliation_iiko_lines)
            .where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id))
        ).map(toCorrLine);
        // Первая загрузка (в т.ч. документа, выбранного офисом) — не изменение: сравниваем только с уже загруженной версией.
        const changes = row.iiko_doc_state ? diffCorrections(before, c.lines) : [];
        const docChanged = row.iiko_document_id !== doc.id || row.iiko_document_num !== doc.num;

        await tx.delete(inventory_reconciliation_iiko_lines).where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id));
        for (let i = 0; i < c.lines.length; i += 500) {
          await tx.insert(inventory_reconciliation_iiko_lines).values(
            c.lines.slice(i, i + 500).map((l) => ({
              reconciliation_id: row.id,
              product_id: l.product_id,
              product_name: l.product_name,
              qty: String(l.qty),
              sum: String(l.sum),
            }))
          );
        }
        const docAt = c.at ?? `${input.period}T23:59:00`;
        await tx
          .update(inventory_reconciliations)
          .set({
            ...base,
            status: row.status === "waiting_iiko" || row.status === "needs_choice" ? "ready" : row.status,
            iiko_document_id: doc.id,
            iiko_document_num: doc.num,
            iiko_document_comment: doc.comment,
            iiko_document_at: docAt,
            book_at: bookAt(docAt, input.period),
            iiko_doc_state: "posted",
            iiko_candidates: null,
            changed_after_accept: row.changed_after_accept || (row.status === "accepted" && changes.length > 0),
          })
          .where(eq(inventory_reconciliations.id, row.id));
        if (docChanged || changes.length || row.iiko_doc_state !== "posted") {
          await writeReconEvent(tx, row.id, "fetched", input.userId, {
            document_id: doc.id,
            num: doc.num,
            comment: doc.comment,
            shortage_sum: doc.shortage_sum,
            surplus_sum: doc.surplus_sum,
            first: !row.iiko_document_id,
            changed: changes.slice(0, 500),
            changed_total: changes.length,
          });
        }
        received.push({ store_id: storeId, num: doc.num });
        return;
      }

      // Документа нет или нужен выбор. Ранее загруженные данные НЕ трогаем.
      const hadDoc = !!row.iiko_document_id;
      const candidates: ReconCandidate[] | null =
        choice.kind === "needs_choice"
          ? choice.candidates.map((d) => ({ id: d.id, num: d.num, comment: d.comment, date: d.date, shortage_sum: d.shortage_sum, surplus_sum: d.surplus_sum }))
          : null;
      const nextStatus =
        row.status === "in_review" || row.status === "accepted" || (hadDoc && row.status === "ready")
          ? row.status
          : choice.kind === "needs_choice"
            ? "needs_choice"
            : "waiting_iiko";
      await tx
        .update(inventory_reconciliations)
        .set({
          ...base,
          status: nextStatus,
          iiko_candidates: candidates,
          iiko_doc_state: hadDoc ? "unposted_after_fetch" : null,
        })
        .where(eq(inventory_reconciliations.id, row.id));
      if (hadDoc && row.iiko_doc_state === "posted") {
        await writeReconEvent(tx, row.id, "doc_missing", input.userId, { num: row.iiko_document_num });
      }
      missing.push(storeId);
    });
  }
  return { scope, received, missing };
}

async function adminAggregate(db: DbLike, storeId: string, period: string): Promise<{ admin: AdminAgg[]; state: ReconAdminState }> {
  const counts = await db
    .select({ id: inventory_counts.id, status: inventory_counts.status })
    .from(inventory_counts)
    .where(and(eq(inventory_counts.store_id, storeId), eq(inventory_counts.period, period), inArray(inventory_counts.status, ["draft", "submitted"])));
  const submitted = counts.filter((c) => c.status === "submitted").map((c) => c.id);
  const state: ReconAdminState = submitted.length ? "submitted" : counts.length ? "draft" : "none";
  if (!submitted.length) return { admin: [], state };
  const res = await db.execute(sql`
    select l.product_id::text as product_id, max(l.product_name) as product_name, max(l.unit_name) as unit_name,
      max(l.group_name) as group_name,
      (sum(l.fact_qty) filter (where not l.skipped))::text as qty,
      bool_and(l.skipped) as all_skipped,
      count(*)::int as counts_n
    from inventory_count_lines l
    where l.count_id in (${uuidList(submitted)})
    group by l.product_id`);
  const rows = res.rows as { product_id: string; product_name: string; unit_name: string | null; group_name: string; qty: string | null; all_skipped: boolean; counts_n: number }[];
  return {
    state,
    admin: rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      unit_name: r.unit_name,
      group_name: r.group_name,
      qty: r.all_skipped ? null : Number(r.qty ?? 0),
      state: r.all_skipped ? "skipped" : "counted",
      counts_n: r.counts_n,
    })),
  };
}

async function productMeta(db: DbLike, ids: string[]): Promise<Map<string, ProductMeta>> {
  const out = new Map<string, ProductMeta>();
  if (!ids.length) return out;
  const res = await db.execute(sql`
    select n.id::text as id, coalesce(n.name, '') as name, mu.name as unit_name, ${GROUP_NAME_SQL} as group_name
    from nomenclature_element n
    left join measure_unit mu on mu.id = n."mainUnit"
    left join nomenclature_group g on g.id = n.parent_id
    left join nomenclature_group gp on gp.id = g.parent_id
    where n.id in (${uuidList(ids)})`);
  for (const r of res.rows as { id: string; name: string; unit_name: string | null; group_name: string }[]) {
    out.set(r.id, { name: r.name, unit_name: r.unit_name, group_name: r.group_name });
  }
  return out;
}

const s = (x: number | null) => (x === null ? null : String(x));

/** Этап 2: учёт на book_at, A из админки, расчёт строк и итогов. Статусы не меняет. */
export async function runStage2(db: DbLike, iiko: IikoClient, input: RunInput & { scope: string[] }): Promise<void> {
  for (const storeId of input.scope) {
    const [row] = await db
      .select()
      .from(inventory_reconciliations)
      .where(and(eq(inventory_reconciliations.store_id, storeId), eq(inventory_reconciliations.period, input.period)));
    if (!row) continue;

    const book = await iiko.balance(storeId, toIikoTimestamp(row.book_at ?? `${input.period}T23:58:00`));
    const { admin, state } = await adminAggregate(db, storeId, input.period);
    const hasDoc = !!row.iiko_document_id;
    const corrections = hasDoc
      ? (
          await db
            .select()
            .from(inventory_reconciliation_iiko_lines)
            .where(eq(inventory_reconciliation_iiko_lines.reconciliation_id, row.id))
        ).map(toCorrLine)
      : null;
    const adminIds = new Set(admin.map((a) => a.product_id));
    const otherIds = [...new Set([...book.map((b) => b.product_id), ...(corrections ?? []).map((c) => c.product_id)])].filter(
      (id) => !adminIds.has(id)
    );
    const lines = buildLines({ admin, book, corrections, meta: await productMeta(db, otherIds) });
    const t = totalsToDb(totals(lines, hasDoc));

    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(inventory_reconciliations).where(eq(inventory_reconciliations.id, row.id)).for("update");
      await tx.delete(inventory_reconciliation_lines).where(eq(inventory_reconciliation_lines.reconciliation_id, row.id));
      for (let i = 0; i < lines.length; i += 500) {
        await tx.insert(inventory_reconciliation_lines).values(
          lines.slice(i, i + 500).map((l) => ({
            reconciliation_id: row.id,
            product_id: l.product_id,
            product_name: l.product_name,
            unit_name: l.unit_name,
            group_name: l.group_name,
            admin_state: l.admin_state,
            admin_qty: s(l.admin_qty),
            admin_counts_n: l.admin_counts_n,
            book_qty: String(l.book_qty),
            book_sum: String(l.book_sum),
            iiko_correction_qty: String(l.iiko_correction_qty),
            iiko_correction_sum: String(l.iiko_correction_sum),
            iiko_fact_qty: s(l.iiko_fact_qty),
            unit_cost: s(l.unit_cost),
            cost_source: l.cost_source,
            diff_ab_qty: s(l.diff_ab_qty),
            diff_ab_sum: s(l.diff_ab_sum),
            diff_ac_sum: s(l.diff_ac_sum),
          }))
        );
      }
      const prev: ReconTotals = {
        lines_total: locked.lines_total,
        mismatch_ab_count: locked.mismatch_ab_count,
        diff_ab_sum: locked.diff_ab_sum,
        diff_ac_sum: locked.diff_ac_sum,
        diff_bc_sum: locked.diff_bc_sum,
      };
      const changed = !locked.calculated_at || !sameTotals(prev, t);
      const accepted = locked.accepted_totals as ReconTotals | null;
      await tx
        .update(inventory_reconciliations)
        .set({
          ...t,
          admin_state: state,
          calculated_at: sql`now()`,
          updated_at: sql`now()`,
          changed_after_accept: locked.changed_after_accept || (locked.status === "accepted" && !sameTotals(accepted, t)),
        })
        .where(eq(inventory_reconciliations.id, row.id));
      if (changed) await writeReconEvent(tx, row.id, "calculated", input.userId, { before: locked.calculated_at ? prev : null, after: t });
    });
  }
}

export async function storeNames(db: DbLike, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: corporation_store.id, name: corporation_store.name }).from(corporation_store).where(inArray(corporation_store.id, ids));
  return new Map(rows.map((r) => [r.id, r.name ?? r.id]));
}

export async function runReconcile(db: DbLike, iiko: IikoClient, input: RunInput, progress: Progress = async () => {}): Promise<Stage1Result> {
  await progress({ state: "stage1", started_at: new Date().toISOString(), error: null });
  const s1 = await runStage1(db, iiko, input);
  const names = await storeNames(db, s1.scope);
  await progress({
    state: "stage2",
    stage1_done_at: new Date().toISOString(),
    received: s1.received.map((r) => ({ ...r, store_name: names.get(r.store_id) ?? r.store_id })),
    missing: s1.missing.map((id) => ({ store_id: id, store_name: names.get(id) ?? id })),
  });
  await runStage2(db, iiko, { ...input, scope: s1.scope });
  await progress({ state: "done", finished_at: new Date().toISOString() });
  return s1;
}
