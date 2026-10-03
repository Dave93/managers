import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { voidHold } from "./service";
import { creditAlert } from "./alert";

// company_id is an optional narrowing filter. Production workers call these with
// no filter (sweep everything); tests pass their own fixture's id so that a
// suite asserting "no mismatches" can never be reported red by unrelated rows
// left behind in a shared database by another suite or by real traffic.
//
// opts.alert defaults to true (production behavior: page the Telegram group on
// a real finding). Every test call site passes { alert: false } — otherwise a
// suite that deliberately corrupts a fixture's balance to prove reconcile
// catches it (or expires a hold to prove the reaper voids it) pages the live
// group with a fixture alert. This is transport suppression only: the
// reconcile/reaper logic and its return value are unaffected either way.
type JobOpts = { alert?: boolean };

// Money in this module is always tiyins (1/100 of a sum) until formatted for a
// human. Divides, rounds to the nearest sum, and groups thousands with a thin
// space the way Telegram renders large sums legibly. Exported for the unit
// test and for anyone composing another human-facing credit message.
export function fmtSum(tiyins: number): string {
  const sum = Math.round(tiyins / 100);
  const sign = sum < 0 ? "-" : "";
  // U+2009 thin space is the typographically-correct thousands separator for
  // Russian — a plain space reads as two adjacent numbers in a chat.
  const grouped = Math.abs(sum).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} сум`;
}

// {period_key} is a literal placeholder substituted by fieldLabel() below, not
// a template-string interpolation — it lets the map stay a plain, testable
// object instead of a function.
export const FIELD_RU: Record<string, string> = {
  reserved: "Резерв по заказам",
  posted: "Задолженность",
  period_spent: "Расход за период {period_key}",
};

export const BRAND_RU: Record<string, string> = {
  chopar: "Chopar",
  les: "Les Ailes",
};

function fieldLabel(field: string, period_key?: string): string {
  const template = FIELD_RU[field] ?? field;
  return period_key ? template.replace("{period_key}", period_key) : template;
}

function shortId(id: string): string {
  return String(id).slice(0, 8);
}

const MAX_LISTED = 10;

async function companyNames(db: any, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const rows = await db.execute(sql`SELECT id, name FROM credit_companies WHERE id = ANY(${ids}::uuid[])`);
  for (const r of rows) map.set(String(r.id), r.name as string);
  return map;
}

// One Telegram message per reconcile run, not one per company: reconcile can in
// principle flag several companies in the same pass, and a message-per-company
// flood trains operators to mute the channel that also carries the reaper
// signal. Fields for the same company are grouped into one block; companies
// beyond MAX_LISTED are summarized rather than dropped silently.
async function composeReconcileAlert(db: any, mismatches: any[]): Promise<string> {
  const order: string[] = [];
  const byCompany = new Map<string, any[]>();
  for (const m of mismatches) {
    const cid = String(m.company_id);
    if (!byCompany.has(cid)) { byCompany.set(cid, []); order.push(cid); }
    byCompany.get(cid)!.push(m);
  }

  const names = await companyNames(db, order);
  const shown = order.slice(0, MAX_LISTED);
  const blocks = shown.map((cid) => {
    const name = names.get(cid) ?? shortId(cid);
    const lines = byCompany.get(cid)!.map((m) => {
      const label = fieldLabel(m.field, m.period_key);
      const diff = Number(m.actual) - Number(m.expected);
      const diffStr = diff > 0 ? `+${fmtSum(diff)}` : fmtSum(diff);
      return `${label}: ожидается ${fmtSum(m.expected)}, фактически ${fmtSum(m.actual)} (разница ${diffStr}).`;
    });
    return `⚠️ Расхождение в учёте — «${name}»\n${lines.join("\n")}\nАвтоматически не исправляется — нужна проверка. Если непонятно, покажите это сообщение разработчику.`;
  });

  let text = blocks.join("\n\n");
  const remaining = order.length - shown.length;
  if (remaining > 0) text += `\n\n…и ещё ${remaining}`;
  return text;
}

// Same one-message-per-run reasoning as composeReconcileAlert. Holds already
// carry their company name (joined in the query below) so this needs no DB
// access of its own.
function composeReaperAlert(holds: any[]): string {
  const shown = holds.slice(0, MAX_LISTED);
  const blocks = shown.map((h) => {
    const name = h.company_name ?? shortId(h.company_id);
    const brandRu = BRAND_RU[h.brand] ?? h.brand;
    return `⏰ Снят просроченный резерв — «${name}»\nЗаказ ${h.order_id} (${brandRu}), ${fmtSum(Number(h.amount))}. Резерв висел дольше срока и возвращён в лимит компании. Если заказ на самом деле доставлен — сообщите разработчику: оплата могла не списаться.`;
  });

  let text = blocks.join("\n\n");
  const remaining = holds.length - shown.length;
  if (remaining > 0) text += `\n\n…и ещё ${remaining}`;
  return text;
}

export async function reconcileAccounts(db: any, company_id?: string, opts?: JobOpts) {
  const cid = company_id ?? null;
  // reserved must equal sum of amounts of live holds; posted must equal signed sum of capture-affecting entries.
  // posted = sum over captured holds of (amount) + sum(payment/refund/adjustment entry amounts)
  //   capture entries carry amount 0 (they move reserve->posted), so derive posted from holds+entries:
  //   'amend' entries are deliberately NOT summed here — they move reserve only,
  //   and the hold amount they adjusted is already counted via credit_holds.
  const rows = await db.execute(sql`
    SELECT a.company_id,
           a.reserved AS actual_reserved,
           a.posted   AS actual_posted,
           COALESCE(h.live_reserved, 0) AS expected_reserved,
           COALESCE(cap.captured_sum, 0) + COALESCE(neg.neg_sum, 0) AS expected_posted
    FROM credit_accounts a
    LEFT JOIN (SELECT company_id, SUM(amount) live_reserved FROM credit_holds WHERE state = 'held' GROUP BY company_id) h USING (company_id)
    LEFT JOIN (SELECT company_id, SUM(amount) captured_sum FROM credit_holds WHERE state = 'captured' GROUP BY company_id) cap USING (company_id)
    LEFT JOIN (SELECT company_id, SUM(amount) neg_sum FROM credit_entries WHERE entry_type IN ('payment','refund','adjustment') GROUP BY company_id) neg USING (company_id)
    WHERE (${cid}::uuid IS NULL OR a.company_id = ${cid})`);
  const mismatches: any[] = [];
  for (const r of rows) {
    if (Number(r.actual_reserved) !== Number(r.expected_reserved))
      mismatches.push({ company_id: r.company_id, field: "reserved", expected: Number(r.expected_reserved), actual: Number(r.actual_reserved) });
    if (Number(r.actual_posted) !== Number(r.expected_posted))
      mismatches.push({ company_id: r.company_id, field: "posted", expected: Number(r.expected_posted), actual: Number(r.actual_posted) });
  }

  // Period spend is re-derived independently of the balances above: it is what
  // enforces the daily/monthly ceilings, so drift here silently either blocks a
  // customer who has headroom or lets one past their limit.
  //
  // expected_spent(company, key) = SUM(amount) of held|captured holds carrying
  // that key (as their day key or their month key — a key is one or the other,
  // never both) MINUS the refunded part booked against it. Amends need no term:
  // they update the hold's amount in place, on the hold's own period keys.
  // Voided/expired holds are excluded because their spend was reversed.
  //
  // ONE-SIDED on purpose: reversePeriods floors at 0, so a legitimate sequence
  // (reverse more than the counter currently holds) leaves actual BELOW derived
  // forever. Only actual > expected is reported — that is the direction where a
  // customer is being blocked by spend that no longer exists.
  const periodRows = await db.execute(sql`
    WITH contrib AS (
      SELECT company_id, period_day_key AS period_key, amount FROM credit_holds WHERE state IN ('held','captured')
      UNION ALL
      SELECT company_id, period_month_key, amount FROM credit_holds WHERE state IN ('held','captured')
      UNION ALL
      SELECT company_id, period_day_key, amount FROM credit_entries WHERE entry_type = 'refund' AND period_day_key IS NOT NULL
      UNION ALL
      SELECT company_id, period_month_key, amount FROM credit_entries WHERE entry_type = 'refund' AND period_month_key IS NOT NULL
    )
    SELECT p.company_id, p.period_key, p.spent AS actual_spent,
           GREATEST(0, COALESCE(SUM(c.amount), 0)) AS expected_spent
    FROM credit_periods p
    LEFT JOIN contrib c ON c.company_id = p.company_id AND c.period_key = p.period_key
    WHERE (${cid}::uuid IS NULL OR p.company_id = ${cid})
    GROUP BY p.company_id, p.period_key, p.spent`);
  for (const r of periodRows) {
    // refund entries store a NEGATIVE amount, so the SUM above already subtracts them.
    if (Number(r.actual_spent) > Number(r.expected_spent))
      mismatches.push({
        company_id: r.company_id, field: "period_spent", period_key: r.period_key,
        expected: Number(r.expected_spent), actual: Number(r.actual_spent),
      });
  }

  if (mismatches.length && (opts?.alert ?? true)) await creditAlert(await composeReconcileAlert(db, mismatches));
  return { mismatches };
}

export async function reapExpiredHolds(db: any, company_id?: string, opts?: JobOpts) {
  const cid = company_id ?? null;
  // company_name comes along for the ride (INNER JOIN is safe: company_id is a
  // NOT NULL FK into credit_companies) so the alert below needs no second query.
  const stale = await db.execute(sql`
    SELECT h.brand, h.order_id, h.amount, h.company_id, c.name AS company_name
    FROM credit_holds h
    JOIN credit_companies c ON c.id = h.company_id
    WHERE h.state = 'held' AND h.expires_at < now()
      AND (${cid}::uuid IS NULL OR h.company_id = ${cid})`);
  let reaped = 0;
  const reapedHolds: any[] = [];
  for (const h of stale) {
    const r = await voidHold(db, h.brand, h.order_id, { as: "expired" });
    if (r.ok) { reaped++; reapedHolds.push(h); }
  }
  if (reaped && (opts?.alert ?? true)) await creditAlert(composeReaperAlert(reapedHolds));
  return { reaped };
}

export async function sweepOrphans(db: any) {
  // REPORT-ONLY stub (orphan-resolver lesson 2026-06-19: never auto-act on an
  // unverified cross-check). The predicate below ("held" holds older than 2h)
  // cannot distinguish a genuinely orphaned hold from a normal in-flight one —
  // authorize()'s default expires_at is +24h, and scheduled orders run longer
  // still, so most rows this returns are healthy orders mid-flight, not
  // orphans. Real orphan detection needs Plan 3's Laravel-side order-status
  // cross-check; until that lands this just aggregates "aging held holds" for
  // whoever calls it directly. NOT wired to creditAlert (see startCreditJobs) —
  // paging the shared alert channel on data this noisy would just train
  // operators to mute the channel that carries the real reconcile/reaper signal.
  const rows = await db.execute(sql`
    SELECT brand, order_id, amount, created_at FROM credit_holds
    WHERE state = 'held' AND created_at < now() - interval '2 hours' LIMIT 50`);
  const report = rows.map((r: any) => `held>2h: ${r.brand}/${r.order_id} ${r.amount}`);
  return { report };
}

export function startCreditJobs(db: any, redisConnection: any) {
  const queue = new Queue("credit-maintenance", { connection: redisConnection });
  // Queue is an EventEmitter; an unhandled 'error' (e.g. Redis connection trouble)
  // throws and takes the process down. index.ts's try/catch around this function
  // only guards the synchronous setup below — it can't catch an async emitter
  // event or a rejected floating promise, so both must be handled here.
  queue.on("error", (e) => console.error("credit-maintenance queue error", e));
  const onAddFail = (name: string) => (e: unknown) => console.error(`credit jobs: ${name} registration failed`, e);
  // upsertJobScheduler (bullmq >= 5.30) replaces `add(..., {repeat})`: it is keyed
  // on the scheduler id, so re-registering on every boot UPDATES the existing
  // schedule instead of leaving an orphaned repeatable behind whenever the cron
  // pattern changes — which with the old API meant the job silently ran on BOTH
  // the old and the new schedule until someone found and removed the stale key.
  // The explicit template `name` matters: the worker below branches on job.name.
  queue.upsertJobScheduler("credit-hold-reaper", { pattern: "*/15 * * * *" }, { name: "credit-hold-reaper" }).catch(onAddFail("credit-hold-reaper"));
  queue.upsertJobScheduler("credit-reconcile", { pattern: "30 3 * * *" }, { name: "credit-reconcile" }).catch(onAddFail("credit-reconcile"));
  // credit-orphan-sweep stays unregistered by default: its predicate (any "held"
  // hold older than 2h) matches ordinary in-flight orders, not just orphans, so
  // registering it unconditionally would page the shared alert channel with
  // false positives from day one. Flip CREDIT_ORPHAN_SWEEP_ENABLED=1 once Plan 3's
  // Laravel cross-check makes the predicate trustworthy.
  if (process.env.CREDIT_ORPHAN_SWEEP_ENABLED === "1") {
    queue.upsertJobScheduler("credit-orphan-sweep", { pattern: "0 4 * * *" }, { name: "credit-orphan-sweep" }).catch(onAddFail("credit-orphan-sweep"));
  } else {
    // NOTE: flipping the flag back off does not unregister an already-created
    // scheduler — call queue.removeJobScheduler("credit-orphan-sweep") for that.
    console.warn("credit jobs: orphan-sweep disabled until Plan 3 cross-check (set CREDIT_ORPHAN_SWEEP_ENABLED=1 to enable)");
  }
  const worker = new Worker("credit-maintenance", async (job) => {
    if (job.name === "credit-hold-reaper") return reapExpiredHolds(db);
    if (job.name === "credit-reconcile") return reconcileAccounts(db);
    if (job.name === "credit-orphan-sweep") {
      const result = await sweepOrphans(db);
      if (result.report.length) console.log("orphan-sweep (report-only):\n" + result.report.join("\n"));
      return result;
    }
  }, { connection: redisConnection });
  worker.on("error", (e) => console.error("credit-maintenance worker error", e));
  worker.on("failed", (job, e) => console.error("credit job failed", job?.name, e));
}
