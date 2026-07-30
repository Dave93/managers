import Elysia, { t } from "elysia";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import {
  authorize, capture, voidHold, refund,
  resolveCompanyByPhone, ensureAccount, dayKey, monthKey,
  type DrizzleDb,
} from "./service";

const brandT = t.Union([t.Literal("chopar"), t.Literal("les")]);
const orderRef = t.Object({ brand: brandT, order_id: t.String() });

export function buildInternalCreditApp(db: DrizzleDb) {
  return new Elysia({ name: "credit-internal" })
    .onError(({ error }) => {
      console.error("credit-internal", error);
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
    }, { body: t.Object({ phone: t.String(), amount: t.Optional(t.Number()) }) })
    .post("/internal/credit/authorize", async ({ body }) => {
      const started = Date.now();
      const r = await authorize(db, { ...body, expires_at: body.expires_at ? new Date(body.expires_at) : undefined });
      console.log(JSON.stringify({ evt: "credit.authorize", brand: body.brand, order_id: body.order_id, amount: body.amount, result: r, ms: Date.now() - started }));
      return r;
    }, { body: t.Object({ brand: brandT, order_id: t.String(), order_number: t.Optional(t.String()), phone: t.String(), amount: t.Number(), expires_at: t.Optional(t.String()) }) })
    .post("/internal/credit/capture", ({ body }) => capture(db, body.brand, body.order_id), { body: orderRef })
    .post("/internal/credit/void", ({ body }) => voidHold(db, body.brand, body.order_id), { body: orderRef })
    .post("/internal/credit/refund", ({ body }) => refund(db, body.brand, body.order_id, body.amount), { body: t.Object({ brand: brandT, order_id: t.String(), amount: t.Optional(t.Number()) }) })
    .post("/internal/credit/history", async ({ body }) => {
      const limit = Math.min(body.limit ?? 100, 1000);
      const rows = await db.execute(sql`
        SELECT * FROM credit_entries
        WHERE (${body.company_id ?? null}::uuid IS NULL OR company_id = ${body.company_id ?? null})
          AND (${body.brand ?? null}::credit_brand IS NULL OR brand = ${body.brand ?? null})
          AND (${body.order_id ?? null}::text IS NULL OR order_id = ${body.order_id ?? null})
        ORDER BY created_at DESC LIMIT ${limit} OFFSET ${body.offset ?? 0}`);
      return { data: rows };
    }, { body: t.Object({ company_id: t.Optional(t.String()), brand: t.Optional(brandT), order_id: t.Optional(t.String()), limit: t.Optional(t.Number()), offset: t.Optional(t.Number()) }) });
}

export function startInternalCreditApp(db: DrizzleDb, socketPath: string) {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true });
  try { fs.unlinkSync(socketPath); } catch {}
  const app = buildInternalCreditApp(db).listen({ unix: socketPath });
  fs.chmodSync(socketPath, 0o660);
  console.log(`credit internal API on unix:${socketPath}`);
  return app;
}
