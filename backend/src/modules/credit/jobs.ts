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
  // REPORT-ONLY (orphan-resolver lesson 2026-06-19). Laravel-side cross-check lands in Plan 3;
  // until then report holds captured >48h ago with no refund/void as "aging".
  const rows = await db.execute(sql`
    SELECT brand, order_id, amount, created_at FROM credit_holds
    WHERE state = 'held' AND created_at < now() - interval '2 hours' LIMIT 50`);
  const report = rows.map((r: any) => `held>2h: ${r.brand}/${r.order_id} ${r.amount}`);
  if (report.length) await creditAlert(`orphan-sweep (report-only):\n${report.join("\n").slice(0, 3500)}`);
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
  queue.add("credit-orphan-sweep", {}, { repeat: { pattern: "0 4 * * *" }, jobId: "credit-orphan-sweep" }).catch(onAddFail("credit-orphan-sweep"));
  const worker = new Worker("credit-maintenance", async (job) => {
    if (job.name === "credit-hold-reaper") return reapExpiredHolds(db);
    if (job.name === "credit-reconcile") return reconcileAccounts(db);
    if (job.name === "credit-orphan-sweep") return sweepOrphans(db);
  }, { connection: redisConnection });
  worker.on("error", (e) => console.error("credit-maintenance worker error", e));
  worker.on("failed", (job, e) => console.error("credit job failed", job?.name, e));
}
