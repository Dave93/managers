import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { authorize } from "../../src/modules/credit/service";
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

test("reconcile detects manual drift", async () => {
  await authorize(db, { brand: "chopar", order_id: "rc-1", phone: PHONE, amount: 100_000 });
  expect((await reconcileAccounts(db)).mismatches.filter(m => m.company_id === companyId)).toEqual([]);
  await db.execute(sql`UPDATE credit_accounts SET reserved = reserved + 5 WHERE company_id = ${companyId}`);
  const m = (await reconcileAccounts(db)).mismatches.filter(x => x.company_id === companyId);
  expect(m.length).toBe(1);
  expect(m[0].field).toBe("reserved");
  await db.execute(sql`UPDATE credit_accounts SET reserved = reserved - 5 WHERE company_id = ${companyId}`); // repair for next tests
});

test("reaper voids expired held holds and restores limits", async () => {
  await authorize(db, { brand: "les", order_id: "rc-2", phone: PHONE, amount: 50_000, expires_at: new Date(Date.now() - 1000) });
  const r = await reapExpiredHolds(db);
  expect(r.reaped).toBeGreaterThanOrEqual(1);
  const [h] = await db.execute(sql`SELECT state FROM credit_holds WHERE brand='les' AND order_id='rc-2'`);
  expect(h.state).toBe("expired");
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(100_000); // only rc-1 remains
});
