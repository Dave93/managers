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
  buildStatementRows,
  companyExists,
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

  test("filters by date range (to in the past excludes everything)", async () => {
    const past = "2000-01-01";
    const st = await getStatement(db, companyId, { to: past });
    expect(st.total).toBe(0);
  });

  test("returns {error: 'not_found'} for a well-formed but nonexistent company id", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const st: any = await getStatement(db, fakeId, {});
    expect(st).toEqual({ error: "not_found" });
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

  test("companies_over_80_monthly is discriminating: absent at 10% spend, present once the limit is lowered to cross 80%", async () => {
    // At the current limit_monthly (1_000_000), month_spent is 100_000 = 10% —
    // must NOT appear. Asserting this BEFORE lowering the limit is the point:
    // it proves the query actually thresholds on 80%, not "any spend at all".
    const before = await getCreditSummary(db);
    expect(before.companies_over_80_monthly.find((c: any) => c.id === companyId)).toBeUndefined();

    // Bump limit_monthly down so the same spend crosses the 80% line
    // (100_000 / 120_000 ≈ 83%), proving the query without a second fixture company.
    await db.update(s.credit_companies).set({ limit_monthly: 120_000 }).where(eq(s.credit_companies.id, companyId));
    const after = await getCreditSummary(db);
    const found = after.companies_over_80_monthly.find((c: any) => c.id === companyId);
    expect(found).toBeTruthy();
  });
});

// Everything below is appended at the end of the file deliberately: these
// tests write extra credit_payments/credit_entries rows (with synthetic
// timestamps, in the date-boundary block) that would otherwise shift the
// exact posted/total-row-count assertions the "statement"/"exportStatementXlsx"/
// "getCreditSummary" describe blocks above depend on.

describe("payCompany metadata", () => {
  test("doc_date/note/created_by land in the credit_payments row", async () => {
    const r = await payCompany(
      companyId,
      { amount: 1_000, doc_number: "PAY-am3-meta", doc_date: "2026-07-15", note: "bank transfer #42" },
      USER_ID
    );
    expect(r.ok).toBe(true);

    const [row] = await db.select().from(s.credit_payments).where(eq(s.credit_payments.doc_number, "PAY-am3-meta"));
    expect(row).toBeTruthy();
    expect(row.amount).toBe(1_000);
    expect(row.note).toBe("bank transfer #42");
    expect(row.created_by).toBe(USER_ID);
    expect(row.doc_date).toBeTruthy();
    expect(new Date(row.doc_date).toISOString().slice(0, 10)).toBe("2026-07-15");
  });
});

describe("companyExists", () => {
  test("true for an existing company, false for a well-formed but absent id", async () => {
    expect(await companyExists(db, companyId)).toBe(true);
    expect(await companyExists(db, "00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("buildStatementRows (export truncation marker)", () => {
  const fakeEntry = { created_at: new Date("2026-01-01T00:00:00Z"), entry_type: "payment", brand: "chopar", order_number: null, amount: -100, balance_after: 200, meta: null };

  test("no marker when total is within the export cap", () => {
    const rows = buildStatementRows([fakeEntry], 1);
    expect(rows.length).toBe(1);
    expect(rows[0].amount).toBe(-1); // -100 tiyins -> -1 сум
  });

  test("appends a truncation marker row when total exceeds the 10k cap", () => {
    const rows = buildStatementRows([fakeEntry], 10_500);
    expect(rows.length).toBe(2);
    const marker = rows[rows.length - 1];
    expect(marker.date).toBe("ВНИМАНИЕ");
    expect(marker.type).toContain("10000");
    expect(marker.type).toContain("10500");
  });
});

describe("statement date filters (Tashkent day boundary)", () => {
  // Fixed, far-past days so these synthetic entries can never collide with
  // any "now"-based fixture entry from the describe blocks above.
  const LATE_DAY = "2020-01-15"; // entry at 23:30 Tashkent that day
  const EARLY_DAY = "2020-01-16"; // entry at 02:00 Tashkent that day (21:00 UTC the day before)
  let lateEntryId: string;
  let earlyEntryId: string;

  beforeAll(async () => {
    const [lateEntry] = await db
      .insert(s.credit_entries)
      .values({
        company_id: companyId,
        entry_type: "adjustment",
        amount: 1,
        balance_after: 0,
        created_at: new Date(`${LATE_DAY}T23:30:00+05:00`),
      })
      .returning();
    lateEntryId = lateEntry.id;

    const [earlyEntry] = await db
      .insert(s.credit_entries)
      .values({
        company_id: companyId,
        entry_type: "adjustment",
        amount: 1,
        balance_after: 0,
        created_at: new Date(`${EARLY_DAY}T02:00:00+05:00`),
      })
      .returning();
    earlyEntryId = earlyEntry.id;
  });

  test("to=<bare day> is inclusive of the whole Tashkent day, not just UTC midnight", async () => {
    // Naive `new Date("2020-01-15")` is 2020-01-15T00:00:00Z = 05:00 Tashkent,
    // which would wrongly exclude the 23:30 Tashkent entry on that same day.
    const st = await getStatement(db, companyId, { from: "2020-01-15", to: "2020-01-15" });
    expect(st.data.some((e: any) => e.id === lateEntryId)).toBe(true);

    const stPrevDay = await getStatement(db, companyId, { from: "2020-01-14", to: "2020-01-14" });
    expect(stPrevDay.data.some((e: any) => e.id === lateEntryId)).toBe(false);
  });

  test("from=<bare day> includes entries made 00:00-05:00 Tashkent that day (UTC previous day)", async () => {
    // The 02:00 Tashkent entry on EARLY_DAY has a UTC created_at still on the
    // previous UTC day. Naive `new Date("2020-01-16")` (UTC midnight) sits
    // AFTER that UTC timestamp, so a `>=` compare against it would wrongly
    // exclude the entry from a `from=2020-01-16` query.
    const st = await getStatement(db, companyId, { from: EARLY_DAY, to: EARLY_DAY });
    expect(st.data.some((e: any) => e.id === earlyEntryId)).toBe(true);

    const stPrevDay = await getStatement(db, companyId, { from: "2020-01-15", to: "2020-01-15" });
    expect(stPrevDay.data.some((e: any) => e.id === earlyEntryId)).toBe(false);
  });

  test("a full ISO timestamp (not a bare day) passes through unmodified", async () => {
    // 2020-01-15T18:59:59.999Z is 1ms before the late entry's UTC instant
    // (2020-01-15T23:30:00+05:00 = 2020-01-15T18:30:00Z) — should exclude it.
    const st = await getStatement(db, companyId, { from: "2020-01-15T18:59:59.999Z", to: "2020-01-15T19:00:00.000Z" });
    expect(st.data.some((e: any) => e.id === lateEntryId)).toBe(false);
  });
});
