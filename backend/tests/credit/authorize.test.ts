import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { authorize, ensureAccount, dayKey, monthKey } from "../../src/modules/credit/service";
import * as s from "../../drizzle/schema";

const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });
const PHONE = "+998900000001";
let companyId: string;

beforeAll(async () => {
  const [c] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-authorize", status: "active",
    limit_total: 1_000_000, limit_daily: 500_000, limit_monthly: 800_000,
  }).returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });
  await ensureAccount(db, companyId);
});

afterAll(async () => {
  for (const t of ["credit_entries","credit_holds","credit_periods","credit_accounts","credit_company_phones"])
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${companyId}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${companyId}'`));
});

test("approves within limits, creates hold+entry+periods", async () => {
  const r = await authorize(db, { brand: "chopar", order_id: "t-1", phone: PHONE, amount: 100_000 });
  expect(r.approved).toBe(true);
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(100_000);
  expect(acc.posted).toBe(0);
});

test("idempotent: same (brand, order_id) returns same hold, no double reserve", async () => {
  const a = await authorize(db, { brand: "chopar", order_id: "t-2", phone: PHONE, amount: 50_000 });
  const b = await authorize(db, { brand: "chopar", order_id: "t-2", phone: PHONE, amount: 50_000 });
  expect(a.approved && b.approved && a.hold_id === b.hold_id).toBe(true);
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(150_000); // 100k from t-1 + 50k once
});

test("declines: unknown phone / suspended / each limit with exact reason", async () => {
  expect((await authorize(db, { brand: "les", order_id: "t-3", phone: "+998999999999", amount: 1 }))).toEqual({ approved: false, reason: "unknown_phone" });
  // daily: 150k already spent today, limit 500k -> 400k must fail daily
  expect((await authorize(db, { brand: "les", order_id: "t-4", phone: PHONE, amount: 400_000 }))).toEqual({ approved: false, reason: "limit_daily" });
  // total: 300k fits daily (450k) and monthly (450k) but with reserved 150k, 900k limit_total -> 900k-150k=850k ok; use amount that only trips total:
  // set tighter: amount 340k -> daily 150+340=490 ok, monthly ok, total 150+340=490 ok -> approves. So craft total trip via limit update:
  await db.execute(sql`UPDATE credit_companies SET limit_total = 200000 WHERE id = ${companyId}`);
  expect((await authorize(db, { brand: "les", order_id: "t-5", phone: PHONE, amount: 100_000 }))).toEqual({ approved: false, reason: "limit_total" });
  await db.execute(sql`UPDATE credit_companies SET limit_total = 1000000 WHERE id = ${companyId}`);
  await db.execute(sql`UPDATE credit_companies SET status = 'suspended' WHERE id = ${companyId}`);
  expect((await authorize(db, { brand: "les", order_id: "t-6", phone: PHONE, amount: 1 }))).toEqual({ approved: false, reason: "suspended" });
  await db.execute(sql`UPDATE credit_companies SET status = 'active' WHERE id = ${companyId}`);
});

test("concurrency: 10 parallel authorizes, only what fits approves", async () => {
  // remaining after previous tests: reserved 150k, total 1000k -> available 850k; daily left 350k -> binding constraint
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    authorize(db, { brand: "chopar", order_id: `t-c-${i}`, phone: PHONE, amount: 100_000 })));
  const approved = rs.filter(r => r.approved).length;
  expect(approved).toBe(3); // 350k daily headroom / 100k = 3
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(150_000 + approved * 100_000);
});
