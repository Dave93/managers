import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import Redis from "ioredis";
import { sql } from "drizzle-orm";
import {
  authorize, ensureAccount, dayKey, monthKey,
  resolveCompanyByPhone, setCreditRedis, invalidateCreditCompanyCache,
} from "../../src/modules/credit/service";
import * as s from "../../drizzle/schema";

const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });
const PHONE = "+998900000001";
const PHONE2 = "+998900000011"; // dedicated: tight daily limit, no prior period row (fresh_over path). 002/003 reserved: credit_company_phones.phone is globally unique, and the fixture-phone plan assigns 002 to lifecycle.test.ts and 003 stays free — collide with either and a crashed run can permanently wedge both suites' beforeAll.
const PHONE3 = "+998900000012"; // dedicated: cross-company replay guard
let companyId: string;
let companyId2: string;
let companyId3: string;

const CHILD_TABLES = ["credit_entries", "credit_holds", "credit_periods", "credit_accounts", "credit_company_phones"];

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
  for (const name of ["TEST-CREDIT-authorize", "TEST-CREDIT-authorize-fresh", "TEST-CREDIT-authorize-mismatch"])
    await purgeCompanyByName(name);

  const [c] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-authorize", status: "active",
    limit_total: 1_000_000, limit_daily: 500_000, limit_monthly: 800_000,
  }).returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });
  await ensureAccount(db, companyId);

  // tight limit_daily, loose total/monthly: any authorize on day 1 hits the
  // fresh-INSERT-over-limit branch of bumpPeriod, never the ON CONFLICT UPDATE branch.
  const [c2] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-authorize-fresh", status: "active",
    limit_total: 1_000_000, limit_daily: 50_000, limit_monthly: 1_000_000,
  }).returning();
  companyId2 = c2.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId2, phone: PHONE2 });
  await ensureAccount(db, companyId2);

  const [c3] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-authorize-mismatch", status: "active",
    limit_total: 1_000_000, limit_daily: 500_000, limit_monthly: 800_000,
  }).returning();
  companyId3 = c3.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId3, phone: PHONE3 });
  await ensureAccount(db, companyId3);
});

afterAll(async () => {
  for (const id of [companyId, companyId2, companyId3]) await purgeCompanyById(id);
});

test("approves within limits, creates hold+entry+periods", async () => {
  const r = await authorize(db, { brand: "chopar", order_id: "t-1", phone: PHONE, amount: 100_000 });
  expect(r.approved).toBe(true);
  if (!r.approved) throw new Error("expected approval");

  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId}`);
  expect(acc.reserved).toBe(100_000);
  expect(acc.posted).toBe(0);

  const [hold] = await db.select().from(s.credit_holds).where(sql`id = ${r.hold_id}`);
  expect(hold.state).toBe("held");
  expect(hold.company_id).toBe(companyId);
  expect(hold.amount).toBe(100_000);
  expect(hold.period_day_key).toBe(dayKey(new Date()));
  expect(hold.period_month_key).toBe(monthKey(new Date()));

  const [entry] = await db.select().from(s.credit_entries).where(sql`hold_id = ${r.hold_id}`);
  expect(entry.entry_type).toBe("authorize");
  expect(entry.amount).toBe(100_000);
  expect(entry.balance_after).toBe(100_000);
  expect(entry.period_day_key).toBe(dayKey(new Date()));
  expect(entry.period_month_key).toBe(monthKey(new Date()));
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

  // total: craft a trip via a temporary tighter limit_total. Mutation is wrapped in
  // try/finally so a failed assertion can never leave the company's limit_total
  // permanently changed for the tests that run after this one.
  await db.execute(sql`UPDATE credit_companies SET limit_total = 200000 WHERE id = ${companyId}`);
  try {
    expect((await authorize(db, { brand: "les", order_id: "t-5", phone: PHONE, amount: 100_000 }))).toEqual({ approved: false, reason: "limit_total" });
  } finally {
    await db.execute(sql`UPDATE credit_companies SET limit_total = 1000000 WHERE id = ${companyId}`);
  }

  await db.execute(sql`UPDATE credit_companies SET status = 'suspended' WHERE id = ${companyId}`);
  try {
    expect((await authorize(db, { brand: "les", order_id: "t-6", phone: PHONE, amount: 1 }))).toEqual({ approved: false, reason: "suspended" });
  } finally {
    await db.execute(sql`UPDATE credit_companies SET status = 'active' WHERE id = ${companyId}`);
  }
});

test("declines: fresh period row over limit_daily (fresh_over path)", async () => {
  // company2 has never authorized before, so credit_periods has no row for today:
  // bumpPeriod takes the fresh-INSERT branch, which bypasses the ON CONFLICT ...
  // WHERE guard entirely, so this exercises the post-check + thrown-reason path.
  const r = await authorize(db, { brand: "chopar", order_id: "t-fresh-1", phone: PHONE2, amount: 100_000 });
  expect(r).toEqual({ approved: false, reason: "limit_daily" });

  // whole transaction must have rolled back: no stray hold, no reserved bump
  const holds = await db.execute(sql`SELECT id FROM credit_holds WHERE brand = 'chopar' AND order_id = 't-fresh-1'`);
  expect(holds.length).toBe(0);
  const [acc] = await db.select().from(s.credit_accounts).where(sql`company_id = ${companyId2}`);
  expect(acc.reserved).toBe(0);
});

test("replay with mismatched company returns service_error (no cross-company leak)", async () => {
  const first = await authorize(db, { brand: "chopar", order_id: "t-mismatch", phone: PHONE3, amount: 10_000 });
  expect(first.approved).toBe(true);

  // (brand, order_id) collides with company3's hold, but this phone resolves to company1
  const second = await authorize(db, { brand: "chopar", order_id: "t-mismatch", phone: PHONE, amount: 10_000 });
  expect(second).toEqual({ approved: false, reason: "service_error" });
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

// Scoped to its own describe so the real redis client (and setCreditRedis's
// global singleton state) only exists for the duration of these two tests —
// every test above this point runs with creditRedis still null (cache bypass),
// which is what keeps their direct-status-toggle assertions (e.g. "declines:
// unknown phone / suspended / each limit") valid: those tests flip
// credit_companies.status back and forth without calling
// invalidateCreditCompanyCache, which would be a stale read if the cache were
// live during their run.
describe("redis config cache", () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: 1,
    });
    redis.on("error", (e) => console.error("test redis client error", e));
    setCreditRedis(redis);
  });

  afterAll(async () => {
    // Reset the module-level singleton back to null before this file's process
    // hands off to any other suite that also imports service.ts — otherwise a
    // live redis handle (and a stale cache) could leak into tests that never
    // expected caching to be active.
    setCreditRedis(null);
    await redis.quit();
  });

  test("cache invalidation: suspend takes effect immediately", async () => {
    // Warm the cache directly (no balance side effects) so the next assertion
    // can prove the cache is actually in the read path, not just that a fresh
    // SELECT sees the new status.
    const warm = await resolveCompanyByPhone(db, PHONE);
    expect(warm?.status).toBe("active");

    await db.execute(sql`UPDATE credit_companies SET status='suspended' WHERE id=${companyId}`);
    try {
      // No invalidation yet: this must still read the cached (pre-suspend) row.
      // If it declined here, the cache isn't actually being read.
      const stale = await authorize(db, { brand: "chopar", order_id: "t-cache-stale", phone: PHONE, amount: 1 });
      expect(stale.approved).toBe(true);

      await invalidateCreditCompanyCache(redis, [PHONE]);
      const declined = await authorize(db, { brand: "chopar", order_id: "t-cache-1", phone: PHONE, amount: 1 });
      expect(declined).toEqual({ approved: false, reason: "suspended" });
    } finally {
      await db.execute(sql`UPDATE credit_companies SET status='active' WHERE id=${companyId}`);
      await invalidateCreditCompanyCache(redis, [PHONE]);
    }
  });

  test("redis down: authorize still authorizes via DB fallback", async () => {
    const brokenRedis = {
      get: async () => { throw new Error("redis unreachable"); },
      setex: async () => { throw new Error("redis unreachable"); },
      del: async () => { throw new Error("redis unreachable"); },
    };
    setCreditRedis(brokenRedis);
    try {
      const r = await authorize(db, { brand: "chopar", order_id: "t-cache-down", phone: PHONE, amount: 1 });
      expect(r.approved).toBe(true);
    } finally {
      setCreditRedis(redis); // restore the real client for this describe's afterAll to quit()
    }
  });
});
