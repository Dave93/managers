import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq } from "drizzle-orm";
import fs from "fs";
import { addPhone, deactivatePhone, saveDocument, deleteDocument } from "../../src/modules/credit_admin/controller";
import * as s from "../../drizzle/schema";

// Same convention as admin_companies.test.ts: DB-level helper tests against a
// drizzle-orm/postgres-js handle (matches modules/credit/db.ts's getCreditDb,
// which every credit test suite runs against). Only plain ORM insert/update/
// select/delete is exercised here — no raw `.execute()` — so the driver-shape
// hazard in modules/credit/db.ts does not apply (same reasoning as Task 1).
const db = drizzle(postgres(process.env.DATABASE_URL!), { schema: s });

const NAME = "TEST-CREDIT-admin2";
const PHONE = "+998900000007";
const USER_ID = "00000000-0000-0000-0000-0000000000a1";
let companyId: string;

// Isolated upload root for this suite — never touches the real
// /home/davr/managers/uploads/credit tree. saveDocument/deleteDocument read
// process.env.CREDIT_UPLOADS_DIR at call time (not at import time), so setting
// it here before any call is sufficient regardless of import order.
const UPLOAD_DIR = `/tmp/credit-uploads-test-${process.pid}`;
process.env.CREDIT_UPLOADS_DIR = UPLOAD_DIR;

const CHILD_TABLES = [
  "credit_entries",
  "credit_holds",
  "credit_periods",
  "credit_accounts",
  "credit_payments",
  "credit_company_documents",
  "credit_company_phones",
];

async function purgeCompanyById(id: string) {
  for (const t of CHILD_TABLES) await db.execute(sql.raw(`DELETE FROM ${t} WHERE company_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM credit_companies WHERE id = '${id}'`));
}

// Idempotent pre-clean keyed on name, same reasoning as admin_companies.test.ts:
// a crashed prior run can leave a company (and its credit_company_phones row)
// behind under the same fixture name, colliding with credit_phone_uniq.
async function purgeCompanyByName(name: string) {
  const rows = await db.execute(sql`SELECT id FROM credit_companies WHERE name = ${name}`);
  for (const row of rows) await purgeCompanyById(row.id as string);
}

// Stub redis: records every key passed to `del` so a test can assert
// invalidateCreditCompanyCache() was called with the right phones, without a
// live redis connection.
function makeRedisStub() {
  const calls: string[][] = [];
  return { calls, del: async (...keys: string[]) => { calls.push(keys); return keys.length; } };
}
const CACHE_KEY = (phone: string) => `credit:company_by_phone:${phone}`;

beforeAll(async () => {
  await purgeCompanyByName(NAME);
  const [row] = await db
    .insert(s.credit_companies)
    .values({
      name: NAME,
      phone: PHONE,
      status: "active",
      limit_total: 100_000,
      limit_daily: 50_000,
      limit_monthly: 100_000,
    })
    .returning();
  companyId = row.id;
});

afterAll(async () => {
  if (companyId) await purgeCompanyById(companyId);
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

describe("admin phone helpers", () => {
  test("addPhone canonicalizes, inserts, and invalidates the added phone", async () => {
    const redis = makeRedisStub();
    const row = await addPhone(db, redis, companyId, { phone: "998900000101", employee_name: "Ivan" });
    expect(row.phone).toBe("+998900000101");
    expect(row.employee_name).toBe("Ivan");
    expect(row.active).toBe(true);
    expect(redis.calls.flat()).toContain(CACHE_KEY("+998900000101"));
  });

  test("addPhone returns {error:'phone_taken'} (not a throw/500) on unique violation", async () => {
    const redis = makeRedisStub();
    const dup = "+998900000102";
    await addPhone(db, redis, companyId, { phone: dup });
    // second insert, different formatting, same canonical phone
    const result = await addPhone(db, redis, companyId, { phone: "998900000102" });
    expect(result).toEqual({ error: "phone_taken" });
  });

  test("deactivatePhone sets active=false and invalidates that phone", async () => {
    const redis = makeRedisStub();
    const [phoneRow] = await db
      .insert(s.credit_company_phones)
      .values({ company_id: companyId, phone: "+998900000103" })
      .returning();

    const row = await deactivatePhone(db, redis, phoneRow.id, false);
    expect(row.active).toBe(false);
    expect(redis.calls.flat()).toContain(CACHE_KEY("+998900000103"));
  });

  test("deactivatePhone can reactivate and invalidates that phone", async () => {
    const redis = makeRedisStub();
    const [phoneRow] = await db
      .insert(s.credit_company_phones)
      .values({ company_id: companyId, phone: "+998900000104", active: false })
      .returning();

    const row = await deactivatePhone(db, redis, phoneRow.id, true);
    expect(row.active).toBe(true);
    expect(redis.calls.flat()).toContain(CACHE_KEY("+998900000104"));
  });
});

describe("admin document helpers", () => {
  test("saveDocument rejects files over 20MB without touching disk", async () => {
    const file: any = {
      name: "big.pdf",
      type: "application/pdf",
      size: 20 * 1024 * 1024 + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    const result = await saveDocument(db, companyId, file, { type: "contract" });
    expect(result).toEqual({ error: "too_large" });
  });

  test("saveDocument rejects disallowed extensions", async () => {
    const file = new File(["x"], "malware.exe", { type: "application/octet-stream" });
    const result = await saveDocument(db, companyId, file, { type: "other" });
    expect(result).toEqual({ error: "bad_type" });
  });

  test("saveDocument writes the file under CREDIT_UPLOADS_DIR/<companyId>/<uuid>.<ext> and inserts a row", async () => {
    const file = new File(["hello world"], "contract.pdf", { type: "application/pdf" });
    const row = await saveDocument(db, companyId, file, {
      type: "contract",
      doc_number: "D-1",
      doc_date: "2026-07-30",
      uploaded_by: USER_ID,
    });

    expect(row.company_id).toBe(companyId);
    expect(row.type).toBe("contract");
    expect(row.doc_number).toBe("D-1");
    expect(row.doc_date).toBeTruthy();
    expect(row.file_path.startsWith(`${UPLOAD_DIR}/${companyId}/`)).toBe(true);
    expect(row.file_path.endsWith(".pdf")).toBe(true);
    expect(fs.existsSync(row.file_path)).toBe(true);
    expect(fs.readFileSync(row.file_path, "utf8")).toBe("hello world");
  });

  test("deleteDocument unlinks the file and removes the row", async () => {
    const file = new File(["bye"], "guarantee.png", { type: "image/png" });
    const doc = await saveDocument(db, companyId, file, { type: "guarantee_letter" });
    expect(fs.existsSync(doc.file_path)).toBe(true);

    await deleteDocument(db, doc.id);

    expect(fs.existsSync(doc.file_path)).toBe(false);
    const [row] = await db.select().from(s.credit_company_documents).where(eq(s.credit_company_documents.id, doc.id));
    expect(row).toBeUndefined();
  });

  test("deleteDocument tolerates a file that is already missing on disk", async () => {
    const file = new File(["gone"], "inn.jpg", { type: "image/jpeg" });
    const doc = await saveDocument(db, companyId, file, { type: "inn_cert" });
    fs.unlinkSync(doc.file_path); // simulate the file having vanished out-of-band

    await deleteDocument(db, doc.id); // must not throw even though the file is already gone

    const [row] = await db.select().from(s.credit_company_documents).where(eq(s.credit_company_documents.id, doc.id));
    expect(row).toBeUndefined();
  });
});
