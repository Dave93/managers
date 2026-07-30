import { Queue, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { voidHold } from "./service";
import { creditAlert } from "./alert";

export async function reconcileAccounts(db: any) {
  // reserved must equal sum of amounts of live holds; posted must equal signed sum of capture-affecting entries.
  // posted = sum over captured holds of (amount) + sum(payment/refund/adjustment entry amounts)
  //   capture entries carry amount 0 (they move reserve->posted), so derive posted from holds+entries:
  const rows = await db.execute(sql`
    SELECT a.company_id,
           a.reserved AS actual_reserved,
           a.posted   AS actual_posted,
           COALESCE(h.live_reserved, 0) AS expected_reserved,
           COALESCE(cap.captured_sum, 0) + COALESCE(neg.neg_sum, 0) AS expected_posted
    FROM credit_accounts a
    LEFT JOIN (SELECT company_id, SUM(amount) live_reserved FROM credit_holds WHERE state = 'held' GROUP BY company_id) h USING (company_id)
    LEFT JOIN (SELECT company_id, SUM(amount) captured_sum FROM credit_holds WHERE state = 'captured' GROUP BY company_id) cap USING (company_id)
    LEFT JOIN (SELECT company_id, SUM(amount) neg_sum FROM credit_entries WHERE entry_type IN ('payment','refund','adjustment') GROUP BY company_id) neg USING (company_id)`);
  const mismatches: any[] = [];
  for (const r of rows) {
    if (Number(r.actual_reserved) !== Number(r.expected_reserved))
      mismatches.push({ company_id: r.company_id, field: "reserved", expected: Number(r.expected_reserved), actual: Number(r.actual_reserved) });
    if (Number(r.actual_posted) !== Number(r.expected_posted))
      mismatches.push({ company_id: r.company_id, field: "posted", expected: Number(r.expected_posted), actual: Number(r.actual_posted) });
  }
  if (mismatches.length) await creditAlert(`RECONCILE MISMATCH (no auto-fix): ${JSON.stringify(mismatches).slice(0, 3500)}`);
  return { mismatches };
}

export async function reapExpiredHolds(db: any) {
  const stale = await db.execute(sql`SELECT brand, order_id FROM credit_holds WHERE state = 'held' AND expires_at < now()`);
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
  queue.add("credit-hold-reaper", {}, { repeat: { pattern: "*/15 * * * *" }, jobId: "credit-hold-reaper" }).catch(onAddFail("credit-hold-reaper"));
  queue.add("credit-reconcile", {}, { repeat: { pattern: "30 3 * * *" }, jobId: "credit-reconcile" }).catch(onAddFail("credit-reconcile"));
  // credit-orphan-sweep stays unregistered by default: its predicate (any "held"
  // hold older than 2h) matches ordinary in-flight orders, not just orphans, so
  // registering it unconditionally would page the shared alert channel with
  // false positives from day one. Flip CREDIT_ORPHAN_SWEEP_ENABLED=1 once Plan 3's
  // Laravel cross-check makes the predicate trustworthy.
  if (process.env.CREDIT_ORPHAN_SWEEP_ENABLED === "1") {
    queue.add("credit-orphan-sweep", {}, { repeat: { pattern: "0 4 * * *" }, jobId: "credit-orphan-sweep" }).catch(onAddFail("credit-orphan-sweep"));
  } else {
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
