import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { buildInternalCreditApp, startInternalCreditApp } from "../../src/modules/credit/internal-app";
import { getCreditDb } from "../../src/modules/credit/db";
import * as s from "../../drizzle/schema";

const db = getCreditDb();
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

test("amend over the socket restates the hold, and authorize then reports amount_mismatch", async () => {
  await call("/internal/credit/authorize", { brand: "chopar", order_id: "s-am", phone: PHONE, amount: 30_000 });
  expect(await call("/internal/credit/amend", { brand: "chopar", order_id: "s-am", amount: 45_000 })).toEqual({ ok: true });
  const [h] = await db.execute(sql`SELECT amount FROM credit_holds WHERE brand='chopar' AND order_id='s-am'`);
  expect(Number(h.amount)).toBe(45_000);

  // the other half of the contract: a stale authorize for the SAME order now
  // tells Laravel to use /amend instead of silently returning the old hold
  expect(await call("/internal/credit/authorize", { brand: "chopar", order_id: "s-am", phone: PHONE, amount: 30_000 }))
    .toEqual({ approved: false, reason: "amount_mismatch" });
});

test("history returns entries for the company, newest first", async () => {
  // authorize then capture on the same order produces two ledger entries at
  // distinct instants (sequential awaited calls) — history must return the more
  // recent one (capture) before the older one (authorize), proving the
  // ORDER BY created_at DESC, id DESC actually orders by recency and not just
  // insertion-id or an unspecified default.
  await call("/internal/credit/authorize", { brand: "chopar", order_id: "s-hist", phone: PHONE, amount: 15_000 });
  await call("/internal/credit/capture", { brand: "chopar", order_id: "s-hist" });

  const r = await call("/internal/credit/history", { company_id: companyId, order_id: "s-hist" });
  expect(Array.isArray(r.data)).toBe(true);
  expect(r.data.length).toBe(2);
  expect(r.data[0].entry_type).toBe("capture");
  expect(r.data[1].entry_type).toBe("authorize");
});

test("invalid brand and non-numeric amount are rejected by schema, never reach service.ts", async () => {
  const res = await fetch("http://localhost/internal/credit/authorize", {
    unix: SOCK,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brand: "not-a-brand", order_id: "s-bad", phone: PHONE, amount: "100000" }),
  } as any);
  expect(res.status).toBe(422);
  const holds = await db.execute(sql`SELECT id FROM credit_holds WHERE order_id = 's-bad'`);
  expect(holds.length).toBe(0);
});

describe("startInternalCreditApp", () => {
  const STARTED_DIR = `/tmp/credit-test-dir-${process.pid}`;
  const STARTED_SOCK = `${STARTED_DIR}/nested/credit.sock`;
  let startedServer: any;

  afterAll(() => {
    startedServer?.stop();
    fs.rmSync(STARTED_DIR, { recursive: true, force: true });
  });

  test("chmods an existing run dir to 0750, unlinks a stale socket file, and chmods the socket 0660", async () => {
    const dir = path.dirname(STARTED_SOCK);
    // pre-create the dir at a permissive default mode so the assertion below can
    // only pass if startInternalCreditApp's explicit chmodSync actually ran —
    // mkdirSync's own `mode` option is a no-op on a dir that already exists.
    fs.mkdirSync(dir, { recursive: true });
    // pre-create a stale (non-socket) file at the target path, simulating a
    // crashed prior run — listen() on an existing path fails unless unlinked first.
    fs.writeFileSync(STARTED_SOCK, "");

    startedServer = startInternalCreditApp(db, STARTED_SOCK);

    expect(fs.statSync(dir).mode & 0o777).toBe(0o750);
    expect(fs.statSync(STARTED_SOCK).mode & 0o777).toBe(0o660);
  });
});
