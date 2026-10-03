import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import { createCompany, updateCompany } from "../../src/modules/credit_admin/controller";
import * as s from "../../drizzle/schema";

// This suite tests the controller's exported handler-logic helpers at the DB
// level (no HTTP/session plumbing) — the same convention as the rest of
// tests/credit/. `db` here is drizzle-orm/postgres-js, matching the other
// suites; in production the route passes ctx's node-postgres `drizzle`
// instead, which is fine for these plain ORM insert/update/select calls (only
// service.ts's raw `.execute()` calls are driver-shape-sensitive — see
// modules/credit/db.ts).
const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });

const NAME = "TEST-CREDIT-admin";
const PHONE = "+998900000005";
const USER_ID = "00000000-0000-0000-0000-0000000000a1";
let companyId: string;

const CHILD_TABLES = ["credit_entries", "credit_holds", "credit_periods", "credit_accounts", "credit_payments", "credit_company_phones"];

async function purgeCompanyById(id: string) {
  for (const t of CHILD_TABLES)
    await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${id}'`));
}

// Idempotent pre-clean keyed on name, same reasoning as the other credit
// suites: a crashed prior run can leave a company (and its
// credit_company_phones row) behind under the same fixture name, which would
// otherwise collide with credit_phone_uniq on the very next insert.
async function purgeCompanyByName(name: string) {
  const rows = await db.execute(sql`SELECT id FROM credit_companies WHERE name = ${name}`);
  for (const row of rows) await purgeCompanyById(row.id as string);
}

// Stub redis: records every key passed to `del` so a test can assert
// invalidateCreditCompanyCache() was called with the right phones, without
// needing a live redis connection.
function makeRedisStub() {
  const calls: string[][] = [];
  return { calls, del: async (...keys: string[]) => { calls.push(keys); return keys.length; } };
}
const CACHE_KEY = (phone: string) => `credit:company_by_phone:${phone}`;

beforeAll(async () => {
  await purgeCompanyByName(NAME);
});

afterAll(async () => {
  if (companyId) await purgeCompanyById(companyId);
});

describe("admin companies CRUD helpers", () => {
  test("createCompany canonicalizes phone and ensures account row", async () => {
    const redis = makeRedisStub();
    const row = await createCompany(db, redis, {
      name: NAME,
      phone: "998900000005", // no plus, no formatting — canonPhone must normalize it
      status: "pending_verification",
      limit_total: 100_000,
      limit_daily: 50_000,
      limit_monthly: 100_000,
    }, USER_ID);
    companyId = row.id;

    expect(row.phone).toBe(PHONE);

    const [account] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(account).toBeTruthy();
    expect(account.posted).toBe(0);
    expect(account.reserved).toBe(0);

    expect(redis.calls.flat()).toContain(CACHE_KEY(PHONE));
  });

  test("updateCompany status change invalidates all company phones", async () => {
    const phone2 = "+998900000006";
    const phone3 = "+998900000007";
    await db.insert(s.credit_company_phones).values([
      { company_id: companyId, phone: phone2 },
      { company_id: companyId, phone: phone3 },
    ]);

    const redis = makeRedisStub();
    const row = await updateCompany(db, redis, companyId, { status: "suspended" }, USER_ID);
    expect(row.status).toBe("suspended");

    const invalidated = redis.calls.flat();
    expect(invalidated).toContain(CACHE_KEY(phone2));
    expect(invalidated).toContain(CACHE_KEY(phone3));
    expect(invalidated).toContain(CACHE_KEY(PHONE)); // credit_companies.phone itself
  });

  test("updateCompany primary phone change invalidates both old and new keys", async () => {
    const newPhone = "+998900000008";
    const redis = makeRedisStub();
    const row = await updateCompany(db, redis, companyId, { phone: "998900000008" }, USER_ID);
    expect(row.phone).toBe(newPhone);

    const invalidated = redis.calls.flat();
    expect(invalidated).toContain(CACHE_KEY(PHONE)); // old primary phone (A->B: A must still be dropped)
    expect(invalidated).toContain(CACHE_KEY(newPhone)); // new primary phone

    // restore PHONE as the primary contact so the later tests' assumptions
    // (createCompany's PHONE-based assertion, cache-key checks) stay valid.
    await updateCompany(db, redis, companyId, { phone: "998900000005" }, USER_ID);
  });

  test("verified flag stamps verified_by/verified_at", async () => {
    const [before] = await db.select().from(s.credit_companies).where(eq(s.credit_companies.id, companyId));
    expect(before.verified_by).toBeNull();
    expect(before.verified_at).toBeNull();

    const redis = makeRedisStub();
    const verifierId = "00000000-0000-0000-0000-0000000000b2";
    const row = await updateCompany(db, redis, companyId, { verified: true }, verifierId);

    expect(row.verified_by).toBe(verifierId);
    expect(row.verified_at).toBeTruthy();

    // a plain update with no `verified` key must not touch either column
    const row2 = await updateCompany(db, redis, companyId, { name: NAME }, USER_ID);
    expect(row2.verified_by).toBe(verifierId);
    expect(row2.verified_at).toEqual(row.verified_at);
  });

  test("verified stamp is once-only: a second verified:true does not overwrite the original verifier/timestamp", async () => {
    // companyId is already verified by verifierId from the previous test.
    const [before] = await db.select().from(s.credit_companies).where(eq(s.credit_companies.id, companyId));
    expect(before.verified_by).toBe("00000000-0000-0000-0000-0000000000b2");
    expect(before.verified_at).toBeTruthy();

    const redis = makeRedisStub();
    const differentUserId = "00000000-0000-0000-0000-0000000000c3";
    const row = await updateCompany(db, redis, companyId, { verified: true }, differentUserId);

    // no error, but the audit trail is preserved — NOT re-stamped to differentUserId
    expect(row.verified_by).toBe(before.verified_by);
    expect(row.verified_at).toEqual(before.verified_at);
  });
});
