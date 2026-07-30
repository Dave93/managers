import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import { buildInternalCreditApp, startInternalCreditApp } from "../../src/modules/credit/internal-app";
import { creditDb as db } from "../../src/modules/credit/db";
import * as s from "../../drizzle/schema";

const PHONE = "+998900000003";
const SOCK = `/tmp/credit-test-${process.pid}.sock`;
let companyId: string;
let server: any;

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

const call = (path: string, body: any) =>
  fetch(`http://localhost${path}`, {
    unix: SOCK,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  } as any).then((r) => r.json());

beforeAll(async () => {
  await purgeCompanyByName("TEST-CREDIT-internal-api");

  const [c] = await db.insert(s.credit_companies).values({
    name: "TEST-CREDIT-internal-api", status: "active",
    limit_total: 1_000_000, limit_daily: 1_000_000, limit_monthly: 1_000_000,
  }).returning();
  companyId = c.id;
  await db.insert(s.credit_company_phones).values({ company_id: companyId, phone: PHONE });

  // crash-safe: a prior run of this suite may have died without closing its
  // listener, leaving the socket file behind (listen() on an existing path fails)
  try { fs.unlinkSync(SOCK); } catch {}
  server = buildInternalCreditApp(db).listen({ unix: SOCK });
});

afterAll(async () => {
  server.stop();
  await purgeCompanyById(companyId);
});

test("check returns availability for known phone", async () => {
  const r = await call("/internal/credit/check", { phone: PHONE });
  expect(r.allowed).toBe(true);
  expect(r.available).toBe(1_000_000);
});

test("check declines unknown phone", async () => {
  const r = await call("/internal/credit/check", { phone: "+998911111199" });
  expect(r).toEqual({ allowed: false, reason: "unknown_phone" });
});

test("authorize->capture->refund over socket", async () => {
  const a = await call("/internal/credit/authorize", { brand: "chopar", order_id: "s-1", order_number: "100500", phone: PHONE, amount: 100_000 });
  expect(a.approved).toBe(true);
  expect((await call("/internal/credit/capture", { brand: "chopar", order_id: "s-1" })).ok).toBe(true);
  expect((await call("/internal/credit/refund", { brand: "chopar", order_id: "s-1" })).ok).toBe(true);
});

test("unknown phone declines with reason", async () => {
  const r = await call("/internal/credit/authorize", { brand: "les", order_id: "s-2", phone: "+998911111111", amount: 1 });
  expect(r).toEqual({ approved: false, reason: "unknown_phone" });
});

test("void releases a held order over socket", async () => {
  await call("/internal/credit/authorize", { brand: "chopar", order_id: "s-3", phone: PHONE, amount: 20_000 });
  expect((await call("/internal/credit/void", { brand: "chopar", order_id: "s-3" })).ok).toBe(true);
  expect((await call("/internal/credit/capture", { brand: "chopar", order_id: "s-3" })).ok).toBe(false);
});

test("capture on nonexistent order returns not_found over socket", async () => {
  expect(await call("/internal/credit/capture", { brand: "chopar", order_id: "no-such-s" })).toEqual({ ok: false, reason: "not_found" });
});

test("history returns entries for the company, newest first", async () => {
  const r = await call("/internal/credit/history", { company_id: companyId, limit: 50 });
  expect(Array.isArray(r.data)).toBe(true);
  expect(r.data.length).toBeGreaterThan(0);
  expect(r.data.every((e: any) => e.company_id === companyId)).toBe(true);
});

describe("startInternalCreditApp", () => {
  const STARTED_SOCK = `/tmp/credit-test-started-${process.pid}.sock`;
  let startedServer: any;

  afterAll(() => {
    startedServer?.stop();
    try { fs.unlinkSync(STARTED_SOCK); } catch {}
  });

  test("creates run dir, unlinks stale socket, and chmods 0660", async () => {
    startedServer = startInternalCreditApp(db, STARTED_SOCK);
    const mode = fs.statSync(STARTED_SOCK).mode & 0o777;
    expect(mode).toBe(0o660);
  });
});
