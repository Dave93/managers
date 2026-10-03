import Elysia, { t } from "elysia";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import {
  authorize, capture, voidHold, refund, amendHold,
  resolveCompanyByPhone, ensureAccount, dayKey, monthKey,
  type DrizzleDb,
} from "./service";

const brandT = t.Union([t.Literal("chopar"), t.Literal("les")]);
const orderRef = t.Object({ brand: brandT, order_id: t.String() });

// One structured JSON line per money-moving call. These are the only record of
// what the socket was asked to do — pm2's log is where an "order X was double
// charged" question gets answered — so every mutating endpoint emits one,
// including the ones whose result is just {ok:true}.
async function logged<T>(evt: string, fields: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await run();
  console.log(JSON.stringify({ evt, ...fields, result, ms: Date.now() - started }));
  return result;
}

export function buildInternalCreditApp(db: DrizzleDb) {
  return new Elysia({ name: "credit-internal" })
    // Error-response contract (Plan 3's CreditClient branches on both HTTP status
    // and body shape): a schema-validation failure (code "VALIDATION") is left to
    // Elysia's default handling (422, its own body) — untouched here — since that's
    // a client bug (bad request), not a service failure. Anything else (an
    // uncaught throw from service.ts, a bug in this file, etc.) is a genuine
    // service failure: explicit 500, and a body shaped to match what the endpoint
    // would have returned on success, so the client can keep using the same
    // discriminant field (`approved` / `allowed` / `ok`) regardless of whether the
    // call failed at the HTTP layer or inside the transaction.
    .onError(({ code, error, path: reqPath, set }) => {
      if (code === "VALIDATION") return;
      console.error("credit-internal", reqPath, error);
      set.status = 500;
      if (reqPath === "/internal/credit/authorize") return { approved: false, reason: "service_error" };
      if (reqPath === "/internal/credit/check") return { allowed: false, reason: "service_error" };
      return { ok: false, reason: "service_error" };
    })
    .post("/internal/credit/check", async ({ body }) => {
      const company = await resolveCompanyByPhone(db, body.phone);
      if (!company) return { allowed: false, reason: "unknown_phone" };
      if (company.status !== "active") return { allowed: false, reason: "suspended" };
      await ensureAccount(db, company.id);
      const now = new Date();
      const [acc] = await db.execute(sql`SELECT posted, reserved FROM credit_accounts WHERE company_id = ${company.id}`);
      const periods = await db.execute(sql`SELECT period_key, spent FROM credit_periods WHERE company_id = ${company.id} AND period_key IN (${dayKey(now)}, ${monthKey(now)})`);
      const spentBy = Object.fromEntries(periods.map((p: any) => [p.period_key, Number(p.spent)]));
      const available = Math.min(
        company.limit_total - Number(acc.posted) - Number(acc.reserved),
        company.limit_daily - (spentBy[dayKey(now)] ?? 0),
        company.limit_monthly - (spentBy[monthKey(now)] ?? 0),
      );
      const allowed = body.amount ? available >= body.amount : available > 0;
      return {
        allowed, company_id: company.id, company_name: company.name,
        available: Math.max(0, available),
        limit_daily_left: Math.max(0, company.limit_daily - (spentBy[dayKey(now)] ?? 0)),
        limit_monthly_left: Math.max(0, company.limit_monthly - (spentBy[monthKey(now)] ?? 0)),
      };
    }, { body: t.Object({ phone: t.String(), amount: t.Optional(t.Integer({ minimum: 1 })) }) })
    .post("/internal/credit/authorize", async ({ body }) => {
      // Destructured explicitly (not `...body`) so the shape reaching service.ts's
      // AuthorizeInput is exactly the 6 fields it's typed for — a spread would
      // silently forward any extra properties a client sends.
      const { brand, order_id, order_number, phone, amount, expires_at } = body;
      return logged("credit.authorize", { brand, order_id, amount }, () =>
        authorize(db, { brand, order_id, order_number, phone, amount, expires_at: expires_at ? new Date(expires_at) : undefined }));
    }, { body: t.Object({
      brand: brandT, order_id: t.String(), order_number: t.Optional(t.String()), phone: t.String(),
      amount: t.Integer({ minimum: 1 }),
      expires_at: t.Optional(t.String({ format: "date-time" })),
    }) })
    // Same order_id, new total (Laravel's resend-composition flow). NOT
    // void+re-authorize: re-authorizing a voided order id is rejected by design,
    // and a plain /authorize replay with a changed amount now returns
    // amount_mismatch pointing here.
    .post("/internal/credit/amend", async ({ body }) => {
      const { brand, order_id, amount } = body;
      return logged("credit.amend", { brand, order_id, amount }, () => amendHold(db, brand, order_id, amount));
    }, { body: t.Object({ brand: brandT, order_id: t.String(), amount: t.Integer({ minimum: 1 }) }) })
    .post("/internal/credit/capture", ({ body }) =>
      logged("credit.capture", { brand: body.brand, order_id: body.order_id }, () => capture(db, body.brand, body.order_id)), { body: orderRef })
    .post("/internal/credit/void", ({ body }) =>
      logged("credit.void", { brand: body.brand, order_id: body.order_id }, () => voidHold(db, body.brand, body.order_id)), { body: orderRef })
    .post("/internal/credit/refund", ({ body }) =>
      logged("credit.refund", { brand: body.brand, order_id: body.order_id, amount: body.amount ?? null }, () => refund(db, body.brand, body.order_id, body.amount)), {
      body: t.Object({ brand: brandT, order_id: t.String(), amount: t.Optional(t.Integer({ minimum: 1 })) }),
    })
    .post("/internal/credit/history", async ({ body }) => {
      const limit = body.limit ?? 100;
      const rows = await db.execute(sql`
        SELECT * FROM credit_entries
        WHERE (${body.company_id ?? null}::uuid IS NULL OR company_id = ${body.company_id ?? null})
          AND (${body.brand ?? null}::credit_brand IS NULL OR brand = ${body.brand ?? null})
          AND (${body.order_id ?? null}::text IS NULL OR order_id = ${body.order_id ?? null})
        ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${body.offset ?? 0}`);
      return { data: rows };
    }, { body: t.Object({
      company_id: t.Optional(t.String()), brand: t.Optional(brandT), order_id: t.Optional(t.String()),
      limit: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
      offset: t.Optional(t.Integer({ minimum: 0 })),
    }) })
    // Read-only: resolves the company behind a (brand, order_id) so the CRM-sync
    // job (Laravel's CrmRouter::newOrder) can put a name, not just a UUID, on the
    // deal comment for credit orders. No `logged()` — this isn't money-moving.
    .post("/internal/credit/company-by-order", async ({ body, set }) => {
      const [row] = await db.execute(sql`
        SELECT h.company_id, c.name
        FROM credit_holds h JOIN credit_companies c ON c.id = h.company_id
        WHERE h.brand = ${body.brand} AND h.order_id = ${body.order_id}
        LIMIT 1`);
      if (!row) {
        set.status = 404;
        return { error: "not_found" };
      }
      return { company_id: row.company_id, name: row.name };
    }, { body: orderRef });
}

export function startInternalCreditApp(db: DrizzleDb, socketPath: string) {
  const dir = path.dirname(socketPath);
  // mkdirSync's `mode` only applies to directories it actually creates — it does
  // NOT chmod an already-existing dir, so the explicit chmodSync below is not
  // redundant: unix filesystem permissions are the entire auth boundary for this
  // socket (no app-level secret), so the run/ dir must never be left wider than
  // 0750 from a previous deploy or manual `mkdir`.
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.chmodSync(dir, 0o750);
  try { fs.unlinkSync(socketPath); } catch {}
  // Narrow the listen()->chmod() window so the socket is never briefly
  // world-or-group-writable at creation: 0o117 makes the OS create it at exactly
  // 0660 (owner+group rw, no execute bit needed on a socket, no `other` access) —
  // the chmod afterward is then a belt-and-suspenders confirmation, not the thing
  // doing the restricting.
  const prevUmask = process.umask(0o117);
  let app;
  try {
    app = buildInternalCreditApp(db).listen({ unix: socketPath });
  } finally {
    process.umask(prevUmask);
  }
  fs.chmodSync(socketPath, 0o660);
  console.log(`credit internal API on unix:${socketPath}`);
  return app;
}
