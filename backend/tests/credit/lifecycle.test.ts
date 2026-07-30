import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { authorize, capture, voidHold, refund, applyPayment, ensureAccount, dayKey } from "../../src/modules/credit/service";
import * as s from "../../drizzle/schema";

const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });
const PHONE = "+998900000002";
let companyId: string;

const CHILD_TABLES = ["credit_entries", "credit_holds", "credit_periods", "credit_accounts", "credit_payments", "credit_company_phones"];

async function purgeCompanyById(id: string) {
  for (const t of CHILD_TABLES)
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${id}'`));
}

// Idempotent pre-clean keyed on name: a crashed prior run can leave a company (and
// its credit_company_phones row) behind under the same fixture name, which would
// otherwise collide with credit_phone_uniq on the very next insert and permanently
// break this beforeAll until someone cleans it up by hand.
async function purgeCompanyByName(name: string) {
  const rows = await db.execute(sql`SELECT id FROM credit_companies WHERE name = ${name}`);
  for (const row of rows) await purgeCompanyById(row.id as string);
}

beforeAll(async () => {
  await purgeCompanyByName("TEST-CREDIT-lifecycle");

  const [c] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-lifecycle", status: "active",
    limit_total: 1_000_000, limit_daily: 1_000_000, limit_monthly: 1_000_000,
  }).returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });
  await ensureAccount(db, companyId);
});

afterAll(async () => {
  await purgeCompanyById(companyId);
});

test("capture moves reserved->posted once (idempotent)", async () => {
  await authorize(db, { brand: "chopar", order_id: "lc-1", phone: PHONE, amount: 100_000 });
  expect((await capture(db, "chopar", "lc-1")).ok).toBe(true);
  expect((await capture(db, "chopar", "lc-1")).ok).toBe(true); // replay = ok, no-op
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc).toMatchObject({ posted: 100_000, reserved: 0 });
});

test("void releases reserve and restores period", async () => {
  await authorize(db, { brand: "les", order_id: "lc-2", phone: PHONE, amount: 200_000 });
  await voidHold(db, "les", "lc-2");
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(0);
  const [day] = await db.execute(sql`SELECT spent FROM credit_periods WHERE company_id=${companyId} AND period_key=${dayKey(new Date())}`);
  expect(Number(day.spent)).toBe(100_000); // only lc-1 remains
  expect((await capture(db, "les", "lc-2")).ok).toBe(false); // captured-after-void must fail
});

test("refund after capture restores posted and periods, idempotent", async () => {
  expect((await refund(db, "chopar", "lc-1")).ok).toBe(true);
  expect((await refund(db, "chopar", "lc-1")).ok).toBe(true); // replay no-op (unique entry)
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.posted).toBe(0);
  const [day] = await db.execute(sql`SELECT spent FROM credit_periods WHERE company_id=${companyId} AND period_key=${dayKey(new Date())}`);
  expect(Number(day.spent)).toBe(0); // floored, both orders reversed
});

test("payment reduces posted, may go negative (overpayment allowed)", async () => {
  const r = await applyPayment(db, companyId, 50_000, { note: "test" });
  expect(r.ok).toBe(true);
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.posted).toBe(-50_000);
});

test("refund of never-captured order fails cleanly", async () => {
  expect((await refund(db, "chopar", "no-such")).ok).toBe(false);
});

// Carried-over gap from Task 2: re-authorize of a (brand, order_id) whose hold was
// voided is a caller bug (must mint a new order_id instead) — authorize() must
// decline it as service_error, never silently approve under the stale hold.
test("re-authorize of same (brand, order_id) after void is declined as service_error", async () => {
  const r = await authorize(db, { brand: "les", order_id: "lc-2", phone: PHONE, amount: 1 });
  expect(r).toEqual({ approved: false, reason: "service_error" });
});

// Carried-over gap from Task 2: expires_at must round-trip through the hold row
// close to what authorize() was given (default is now + 24h when omitted).
test("expires_at round-trips on the stored hold", async () => {
  const given = new Date(Date.now() + 2 * 3600 * 1000); // 2h from now
  const r = await authorize(db, { brand: "chopar", order_id: "lc-3", phone: PHONE, amount: 10_000, expires_at: given });
  expect(r.approved).toBe(true);
  if (!r.approved) throw new Error("expected approval");
  const [hold] = await db.select().from(s.credit_holds).where(sql`id = ${r.hold_id}`);
  const diffMs = Math.abs(new Date(hold.expires_at as unknown as string).getTime() - given.getTime());
  expect(diffMs).toBeLessThan(5_000); // sane window, well under a second in practice
});
