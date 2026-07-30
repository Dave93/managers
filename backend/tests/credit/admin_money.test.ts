import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  payCompany,
  adjustCompany,
  listPayments,
  getStatement,
  exportStatementXlsx,
  getCreditSummary,
} from "../../src/modules/credit_admin/controller";
import { authorize, capture, ensureAccount } from "../../src/modules/credit/service";
import { getCreditDb } from "../../src/modules/credit/db";
import * as s from "../../drizzle/schema";

// Same convention as the rest of tests/credit/: exported controller helpers are
// tested at the DB level (no HTTP/session plumbing). `db` here is
// drizzle-orm/postgres-js — used for the pure-read helpers (statement/summary),
// matching what ctx's drizzle would be in production for those SELECT-only
// paths. Money-moving helpers (payCompany/adjustCompany) take no `db` param at
// all: per CONTRACT.md they must always go through getCreditDb(), never a
// caller-supplied handle, so seeding here uses the same service functions
// (authorize/capture) against getCreditDb() too — not raw SQL — to prove the
// real service path, not a reimplementation of it.
const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });

const NAME = "TEST-CREDIT-admin3";
const PHONE = "+998900000006";
const USER_ID = "00000000-0000-0000-0000-0000000000a1";
let companyId: string;

const CHILD_TABLES = ["credit_entries", "credit_holds", "credit_periods", "credit_accounts", "credit_payments", "credit_company_phones"];

async function purgeCompanyById(id: string) {
  for (const t of CHILD_TABLES) await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${id}'`));
}

// Idempotent pre-clean keyed on name, same reasoning as the other admin
// suites: a crashed prior run can leave a company (and its
// credit_company_phones row) behind under the same fixture name, colliding
// with credit_phone_uniq on the very next insert.
async function purgeCompanyByName(name: string) {
  const rows = await db.execute(sql`SELECT id FROM credit_companies WHERE name = ${name}`);
  for (const row of rows) await purgeCompanyById(row.id as string);
}

beforeAll(async () => {
  await purgeCompanyByName(NAME);
  const [c] = await db
    .insert(s.credit_companies)
    .values({
      name: NAME,
      phone: PHONE,
      status: "active",
      limit_total: 1_000_000,
      limit_daily: 500_000,
      limit_monthly: 1_000_000,
    })
    .returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });
  await ensureAccount(getCreditDb(), companyId);
});

afterAll(async () => {
  if (companyId) await purgeCompanyById(companyId);
});

describe("payCompany", () => {
  test("delegates to applyPayment(getCreditDb()) and reduces posted", async () => {
    // seed 100_000 of posted debt via the real service path (authorize+capture)
    const auth = await authorize(getCreditDb(), { brand: "chopar", order_id: "am3-1", phone: PHONE, amount: 100_000 });
    expect(auth.approved).toBe(true);
    const cap = await capture(getCreditDb(), "chopar", "am3-1");
    expect(cap.ok).toBe(true);

    const [before] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(before.posted).toBe(100_000);

    const r = await payCompany(companyId, { amount: 40_000, doc_number: "PAY-am3-1" }, USER_ID);
    expect(r.ok).toBe(true);

    const [after] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(after.posted).toBe(60_000);
  });

  test("replaying the same doc_number is a no-op: duplicate_doc, posted unchanged", async () => {
    const [before] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));

    const r = await payCompany(companyId, { amount: 40_000, doc_number: "PAY-am3-1" }, USER_ID);
    expect(r).toEqual({ ok: true, reason: "duplicate_doc" });

    const [after] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(after.posted).toBe(before.posted); // no second debit
  });
});

describe("adjustCompany", () => {
  test("positive amount reduces debt", async () => {
    const [before] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    const r = await adjustCompany(companyId, { amount: 10_000, reason: "write-off" }, USER_ID);
    expect(r.ok).toBe(true);
    const [after] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(after.posted).toBe(before.posted - 10_000);
  });

  test("negative amount increases debt", async () => {
    const [before] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    const r = await adjustCompany(companyId, { amount: -5_000, reason: "disputed charge" }, USER_ID);
    expect(r.ok).toBe(true);
    const [after] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(after.posted).toBe(before.posted + 5_000);
  });

  test("zero amount rejected as bad_amount, no state change", async () => {
    const [before] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    const r = await adjustCompany(companyId, { amount: 0, reason: "x" }, USER_ID);
    expect(r).toEqual({ ok: false, reason: "bad_amount" });
    const [after] = await db.select().from(s.credit_accounts).where(eq(s.credit_accounts.company_id, companyId));
    expect(after.posted).toBe(before.posted);
  });
});

describe("listPayments", () => {
  test("returns payments for the company, newest first", async () => {
    const { data } = await listPayments(db, companyId);
    expect(data.length).toBe(1); // only the one non-duplicate payment above
    expect(data[0].doc_number).toBe("PAY-am3-1");
    expect(data[0].amount).toBe(40_000);
  });
});

describe("statement", () => {
  test("summary math: posted/reserved/available/day_spent/month_spent", async () => {
    // At this point (after the money describe blocks above, run in file order):
    // posted = 100_000 (capture) - 40_000 (payment) - 10_000 (adjustment +, reduces debt) + 5_000 (adjustment -, increases debt) = 55_000
    // reserved = 0 (fully captured)
    // day_spent/month_spent (credit_periods) only ever bumped by authorize = 100_000
    const st = await getStatement(db, companyId, {});
    expect(st.summary.posted).toBe(55_000);
    expect(st.summary.reserved).toBe(0);
    expect(st.summary.day_spent).toBe(100_000);
    expect(st.summary.month_spent).toBe(100_000);
    expect(st.summary.limit_total).toBe(1_000_000);
    expect(st.summary.limit_daily).toBe(500_000);
    expect(st.summary.limit_monthly).toBe(1_000_000);
    // available = min(limit_total-posted-reserved, limit_daily-day_spent, limit_monthly-month_spent)
    //           = min(1_000_000-55_000-0, 500_000-100_000, 1_000_000-100_000) = min(945_000, 400_000, 900_000) = 400_000
    expect(st.summary.available).toBe(400_000);
  });

  test("entries: authorize + capture + payment + 2 adjustments = 5 rows, newest first", async () => {
    const st = await getStatement(db, companyId, {});
    expect(st.total).toBe(5);
    expect(st.data.length).toBe(5);
    // ORDER BY created_at DESC, id DESC -> most recent adjustment first
    expect(st.data[0].entry_type).toBe("adjustment");
    const types = st.data.map((e: any) => e.entry_type).sort();
    expect(types).toEqual(["adjustment", "adjustment", "authorize", "capture", "payment"]);
  });

  test("filters by brand", async () => {
    const st = await getStatement(db, companyId, { brand: "les" });
    expect(st.total).toBe(0);
    expect(st.data).toEqual([]);
  });

  test("filters by date range (from in the future excludes everything)", async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const st = await getStatement(db, companyId, { from: future });
    expect(st.total).toBe(0);
  });
});

describe("exportStatementXlsx", () => {
  test("produces an xlsx buffer with amounts converted to сумы (/100)", async () => {
    const buf = await exportStatementXlsx(db, companyId, {});
    expect(Buffer.isBuffer(buf) || buf instanceof Uint8Array).toBe(true);

    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);
    expect(rows.length).toBe(5);

    const payment = rows.find((r) => r.type === "payment");
    expect(payment).toBeTruthy();
    // raw ledger amount is -40_000 tiyins; xlsx must show сумы (÷100), and only here
    expect(payment.amount).toBe(-400);
  });
});

describe("getCreditSummary", () => {
  test("includes this company in top_debtors and totals its debt", async () => {
    const summary = await getCreditSummary(db);
    expect(summary.total_debt).toBeGreaterThanOrEqual(55_000);
    const found = summary.top_debtors.find((c: any) => c.id === companyId);
    expect(found).toBeTruthy();
    expect(found.posted).toBe(55_000);
  });

  test("companies_over_80_monthly includes this company (100_000 / 1_000_000 limit... )", async () => {
    // day/month spend is 100_000 against limit_monthly 1_000_000 = 10%, NOT over 80%.
    // Bump limit_monthly down via a direct update so this company crosses the 80% line,
    // proving the query without needing a second fixture company.
    await db.update(s.credit_companies).set({ limit_monthly: 120_000 }).where(eq(s.credit_companies.id, companyId));
    const summary = await getCreditSummary(db);
    const found = summary.companies_over_80_monthly.find((c: any) => c.id === companyId);
    expect(found).toBeTruthy();
  });
});
