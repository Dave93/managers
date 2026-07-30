import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { voidHold } from "./service";
import { creditAlert } from "./alert";

// company_id is an optional narrowing filter. Production workers call these with
// no filter (sweep everything); tests pass their own fixture's id so that a
// suite asserting "no mismatches" can never be reported red by unrelated rows
// left behind in a shared database by another suite or by real traffic.
export async function reconcileAccounts(db: any, company_id?: string) {
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

  if (mismatches.length) await creditAlert(`RECONCILE MISMATCH (no auto-fix): ${JSON.stringify(mismatches).slice(0, 3500)}`);
  return { mismatches };
}

export async function reapExpiredHolds(db: any, company_id?: string) {
  const cid = company_id ?? null;
  const stale = await db.execute(sql`
    SELECT brand, order_id FROM credit_holds
    WHERE state = 'held' AND expires_at < now()
      AND (${cid}::uuid IS NULL OR company_id = ${cid})`);
  let reaped = 0;
  for (const h of stale) {
    const r = await voidHold(db, h.brand, h.order_id, { as: "expired" });
    if (r.ok) reaped++;
  }
  if (reaped) await creditAlert(`hold-reaper expired ${reaped} hold(s) — each one means a broken capture chain, investigate`);
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
