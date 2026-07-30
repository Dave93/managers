import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { authorize, applyAdjustment, dayKey } from "../../src/modules/credit/service";
import { reconcileAccounts, reapExpiredHolds } from "../../src/modules/credit/jobs";
import * as s from "../../drizzle/schema";

const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });
const PHONE = "+998900000004";
let companyId: string;

const CHILD_TABLES = ["credit_entries", "credit_holds", "credit_periods", "credit_accounts", "credit_payments", "credit_company_phones"];

async function purgeCompanyById(id: string) {
  for (const t of CHILD_TABLES)
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${id}'`));
}

// Idempotent pre-clean keyed on name: a crashed prior run can leave a company (and
// its credit_company_phones row) behind under the same fixture name, which would
// otherwise collide with credit_phone_uniq on the very next insert.
async function purgeCompanyByName(name: string) {
  const rows = await db.execute(sql`SELECT id FROM credit_companies WHERE name = ${name}`);
  for (const row of rows) await purgeCompanyById(row.id as string);
}

beforeAll(async () => {
  await purgeCompanyByName("TEST-CREDIT-reconcile");

  const [c] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-reconcile", status: "active",
    limit_total: 1_000_000, limit_daily: 1_000_000, limit_monthly: 1_000_000,
  }).returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });
  await db.execute(sql`
    INSERT INTO credit_accounts (company_id) VALUES (${companyId})
    ON CONFLICT (company_id) DO NOTHING`);
});

afterAll(async () => {
  await purgeCompanyById(companyId);
});

// Both jobs are called with this suite's own company id. The unscoped form is
// what production runs, but in a shared database an unscoped assertion of "no
// mismatches" is really an assertion about every other suite's leftovers (and,
// on a live box, about real customer rows) — a guaranteed flake.
test("reconcile detects manual drift", async () => {
  await authorize(db, { brand: "chopar", order_id: "rc-1", phone: PHONE, amount: 100_000 });
  expect((await reconcileAccounts(db, companyId)).mismatches).toEqual([]);
  await db.execute(sql`UPDATE credit_accounts SET reserved = reserved + 5 WHERE company_id = ${companyId}`);
  const m = (await reconcileAccounts(db, companyId)).mismatches;
  expect(m.length).toBe(1);
  expect(m[0].field).toBe("reserved");
  await db.execute(sql`UPDATE credit_accounts SET reserved = reserved - 5 WHERE company_id = ${companyId}`); // repair for next tests
});

test("reconcile detects a period counter that over-counts", async () => {
  // Over-counting is the one-sided case worth alerting on: spend that no longer
  // exists keeps blocking a customer who actually has headroom.
  await db.execute(sql`UPDATE credit_periods SET spent = spent + 7 WHERE company_id = ${companyId} AND period_key = ${dayKey(new Date())}`);
  try {
    const m = (await reconcileAccounts(db, companyId)).mismatches;
    expect(m.length).toBe(1);
    expect(m[0]).toMatchObject({ field: "period_spent", period_key: dayKey(new Date()), actual: 100_007, expected: 100_000 });
  } finally {
    await db.execute(sql`UPDATE credit_periods SET spent = spent - 7 WHERE company_id = ${companyId} AND period_key = ${dayKey(new Date())}`);
  }

  // under-counting is NOT reported: reversePeriods floors at 0, so a counter
  // legitimately sitting below the derived value is not evidence of a bug
  await db.execute(sql`UPDATE credit_periods SET spent = spent - 7 WHERE company_id = ${companyId} AND period_key = ${dayKey(new Date())}`);
  try {
    expect((await reconcileAccounts(db, companyId)).mismatches).toEqual([]);
  } finally {
    await db.execute(sql`UPDATE credit_periods SET spent = spent + 7 WHERE company_id = ${companyId} AND period_key = ${dayKey(new Date())}`);
  }
});

test("reaper voids expired held holds and restores limits", async () => {
  await authorize(db, { brand: "les", order_id: "rc-2", phone: PHONE, amount: 50_000, expires_at: new Date(Date.now() - 1000) });
  const r = await reapExpiredHolds(db, companyId);
  expect(r.reaped).toBe(1); // scoped: exactly this suite's expired hold
  const [h] = await db.execute(sql`SELECT state FROM credit_holds WHERE brand='les' AND order_id='rc-2'`);
  expect(h.state).toBe("expired");
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(100_000); // only rc-1 remains
});

test("adjustment moves debt in both directions and leaves reconciliation clean", async () => {
  const [before] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);

  // positive = debt reduction (write-off), same sign convention as a payment
  expect(await applyAdjustment(db, companyId, 30_000, { reason: "write-off: disputed order" })).toEqual({ ok: true });
  const [afterCredit] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(afterCredit.posted).toBe(before.posted - 30_000);

  // negative = debt increase (re-charge)
  expect(await applyAdjustment(db, companyId, -10_000, { reason: "manual re-charge" })).toEqual({ ok: true });
  const [afterDebit] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(afterDebit.posted).toBe(before.posted - 20_000);

  // doubles as proof that the ledger entries applyAdjustment writes are exactly
  // what reconcileAccounts' expected_posted formula re-derives
  expect((await reconcileAccounts(db, companyId)).mismatches).toEqual([]);

  const entries = await db.execute(sql`SELECT amount, meta FROM credit_entries WHERE company_id=${companyId} AND entry_type='adjustment' ORDER BY created_at, id`);
  expect(entries.map((e: any) => Number(e.amount))).toEqual([-30_000, 10_000]);
  expect(entries[0].meta).toMatchObject({ reason: "write-off: disputed order" });
});

test("adjustment rejects zero, fractional and unexplained input", async () => {
  const [before] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(await applyAdjustment(db, companyId, 0, { reason: "x" })).toEqual({ ok: false, reason: "bad_amount" });
  expect(await applyAdjustment(db, companyId, 1.5, { reason: "x" })).toEqual({ ok: false, reason: "bad_amount" });
  expect(await applyAdjustment(db, companyId, 1_000, { reason: "   " })).toEqual({ ok: false, reason: "bad_reason" });
  const [after] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(after.posted).toBe(before.posted);
});
