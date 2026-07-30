import { and, eq, sql } from "drizzle-orm";
import * as s from "../../../drizzle/schema";
import type { AuthorizeInput, AuthorizeResult, DeclineReason, OpResult } from "./types";

export type DrizzleDb = any; // matches ctx drizzle instance type used across modules

const TZ = "Asia/Tashkent";
export const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // sv-SE => YYYY-MM-DD
export const monthKey = (d: Date) => dayKey(d).slice(0, 7);

export async function resolveCompanyByPhone(db: DrizzleDb, phone: string) {
  const rows = await db
    .select({
      id: s.credit_companies.id, name: s.credit_companies.name,
      status: s.credit_companies.status,
      limit_total: s.credit_companies.limit_total,
      limit_daily: s.credit_companies.limit_daily,
      limit_monthly: s.credit_companies.limit_monthly,
    })
    .from(s.credit_company_phones)
    .innerJoin(s.credit_companies, eq(s.credit_company_phones.company_id, s.credit_companies.id))
    .where(and(eq(s.credit_company_phones.phone, phone), eq(s.credit_company_phones.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureAccount(db: DrizzleDb, company_id: string) {
  await db.execute(sql`
    INSERT INTO credit_accounts (company_id) VALUES (${company_id})
    ON CONFLICT (company_id) DO NOTHING`);
}

// The ON CONFLICT ... WHERE guard only applies to the UPDATE branch; a brand-new
// period row bypasses it entirely, so a fresh INSERT can land over limit. The
// post-check below catches that case and throws with the caller-supplied reason
// (day vs month) so authorize() reports the correct decline reason either way.
async function bumpPeriod(tx: DrizzleDb, company_id: string, period_key: string, amount: number, limit: number, reason: DeclineReason): Promise<boolean> {
  const r = await tx.execute(sql`
    INSERT INTO credit_periods (company_id, period_key, spent)
    VALUES (${company_id}, ${period_key}, ${amount})
    ON CONFLICT (company_id, period_key)
    DO UPDATE SET spent = credit_periods.spent + EXCLUDED.spent
    WHERE credit_periods.spent + EXCLUDED.spent <= ${limit}
    RETURNING spent`);
  if (r.length > 0 && Number(r[0].spent) > limit) throw Object.assign(new Error("limit"), { fresh_over: reason });
  return r.length > 0;
}

export async function authorize(db: DrizzleDb, input: AuthorizeInput): Promise<AuthorizeResult> {
  if (!(input.amount > 0)) return { approved: false, reason: "service_error" };

  let decline: DeclineReason | null = null;
  let holdId: string | null = null;

  try {
    // resolveCompanyByPhone/ensureAccount are inside the try now: a DB failure here
    // must surface as service_error, not as a rejected promise escaping authorize().
    const company = await resolveCompanyByPhone(db, input.phone);
    if (!company) return { approved: false, reason: "unknown_phone" };
    if (company.status !== "active") return { approved: false, reason: "suspended" };
    await ensureAccount(db, company.id);

    const now = new Date();
    const dk = dayKey(now), mk = monthKey(now);
    const expires = input.expires_at ?? new Date(now.getTime() + 24 * 3600 * 1000);

    let resultCompanyId: string | null = null;

    await db.transaction(async (tx: DrizzleDb) => {
      // 1. idempotency gate: try to insert hold first
      const ins = await tx.execute(sql`
        INSERT INTO credit_holds (company_id, brand, order_id, order_number, amount, state, period_day_key, period_month_key, expires_at)
        VALUES (${company.id}, ${input.brand}, ${input.order_id}, ${input.order_number ?? null}, ${input.amount}, 'held', ${dk}, ${mk}, ${expires.toISOString()})
        ON CONFLICT (brand, order_id) DO NOTHING
        RETURNING id`);
      if (ins.length === 0) {
        // replay: return existing hold (any non-voided state counts as approved-before)
        const ex = await tx.execute(sql`
          SELECT id, state, company_id FROM credit_holds WHERE brand = ${input.brand} AND order_id = ${input.order_id}`);
        if (ex.length && ex[0].state !== "voided" && ex[0].state !== "expired") {
          if (ex[0].company_id !== company.id) {
            // this phone resolves to a different company than the one that already
            // owns the hold — never approve under a company that doesn't own it
            decline = "service_error";
            throw new Error("rollback");
          }
          holdId = ex[0].id;
          resultCompanyId = ex[0].company_id;
          return; // idempotent success, no balance change
        }
        decline = "service_error"; // re-authorize of voided order is a caller bug (must use new order_id)
        throw new Error("rollback");
      }
      holdId = ins[0].id;
      resultCompanyId = company.id;

      // 2. total ceiling — conditional update, lock order: accounts -> day -> month
      const acc = await tx.execute(sql`
        UPDATE credit_accounts a
        SET reserved = a.reserved + ${input.amount}, version = a.version + 1, updated_at = now()
        FROM credit_companies c
        WHERE a.company_id = ${company.id} AND c.id = a.company_id
          AND c.limit_total - a.posted - a.reserved >= ${input.amount}
        RETURNING a.posted + a.reserved AS balance_after`);
      if (acc.length === 0) { decline = "limit_total"; throw new Error("rollback"); }

      // 3. day, 4. month
      if (!(await bumpPeriod(tx, company.id, dk, input.amount, company.limit_daily, "limit_daily"))) { decline = "limit_daily"; throw new Error("rollback"); }
      if (!(await bumpPeriod(tx, company.id, mk, input.amount, company.limit_monthly, "limit_monthly"))) { decline = "limit_monthly"; throw new Error("rollback"); }

      // 5. ledger entry
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key)
        VALUES (${company.id}, ${holdId}, ${input.brand}, ${input.order_id}, ${input.order_number ?? null}, 'authorize', ${input.amount}, ${acc[0].balance_after}, ${dk}, ${mk})`);
    });

    return { approved: true, hold_id: holdId!, company_id: resultCompanyId! };
  } catch (e: any) {
    if (e?.fresh_over) decline = e.fresh_over as DeclineReason;
    if (decline) return { approved: false, reason: decline };
    console.error("credit.authorize error", e);
    return { approved: false, reason: "service_error" };
  }
}

export async function capture(db: DrizzleDb, brand: string, order_id: string): Promise<OpResult> {
  try {
    let ok = false;
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        UPDATE credit_holds SET state='captured', updated_at=now()
        WHERE brand=${brand} AND order_id=${order_id} AND state='held'
        RETURNING id, company_id, amount, order_number, period_day_key, period_month_key`);
      if (h.length === 0) {
        const ex = await tx.execute(sql`SELECT state FROM credit_holds WHERE brand=${brand} AND order_id=${order_id}`);
        ok = ex.length > 0 && ex[0].state === "captured"; // replay ok; missing/voided -> false
        return;
      }
      const hold = h[0];
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET reserved = reserved - ${hold.amount}, posted = posted + ${hold.amount}, version = version + 1, updated_at = now()
        WHERE company_id = ${hold.company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key)
        VALUES (${hold.company_id}, ${hold.id}, ${brand}, ${order_id}, ${hold.order_number}, 'capture', 0, ${acc[0].balance_after}, ${hold.period_day_key}, ${hold.period_month_key})
        ON CONFLICT (brand, order_id, entry_type) DO NOTHING`);
      ok = true;
    });
    return { ok };
  } catch (e) { console.error("credit.capture", e); return { ok: false, reason: "service_error" }; }
}

async function reversePeriods(tx: DrizzleDb, company_id: string, dk: string, mk: string, amount: number) {
  // floor at 0 per spec
  await tx.execute(sql`UPDATE credit_periods SET spent = GREATEST(0, spent - ${amount}) WHERE company_id=${company_id} AND period_key IN (${dk}, ${mk})`);
}

export async function voidHold(db: DrizzleDb, brand: string, order_id: string, opts?: { as?: "voided" | "expired" }): Promise<OpResult> {
  const target = opts?.as ?? "voided";
  try {
    let ok = false;
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        UPDATE credit_holds SET state=${target}::credit_hold_state, updated_at=now()
        WHERE brand=${brand} AND order_id=${order_id} AND state='held'
        RETURNING id, company_id, amount, order_number, period_day_key, period_month_key`);
      if (h.length === 0) {
        const ex = await tx.execute(sql`SELECT state FROM credit_holds WHERE brand=${brand} AND order_id=${order_id}`);
        ok = ex.length > 0 && (ex[0].state === "voided" || ex[0].state === "expired"); // replay
        return;
      }
      const hold = h[0];
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET reserved = reserved - ${hold.amount}, version = version + 1, updated_at = now()
        WHERE company_id = ${hold.company_id}
        RETURNING posted + reserved AS balance_after`);
      await reversePeriods(tx, hold.company_id, hold.period_day_key, hold.period_month_key, hold.amount);
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key)
        VALUES (${hold.company_id}, ${hold.id}, ${brand}, ${order_id}, ${hold.order_number}, 'void', ${-hold.amount}, ${acc[0].balance_after}, ${hold.period_day_key}, ${hold.period_month_key})
        ON CONFLICT (brand, order_id, entry_type) DO NOTHING`);
      ok = true;
    });
    return { ok };
  } catch (e) { console.error("credit.void", e); return { ok: false, reason: "service_error" }; }
}

export async function refund(db: DrizzleDb, brand: string, order_id: string, amount?: number): Promise<OpResult> {
  try {
    let ok = false;
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        SELECT id, company_id, amount, order_number, period_day_key, period_month_key
        FROM credit_holds WHERE brand=${brand} AND order_id=${order_id} AND state='captured'`);
      if (h.length === 0) { ok = false; return; }
      const hold = h[0];
      const amt = Math.min(amount ?? Number(hold.amount), Number(hold.amount));
      // idempotency: unique (brand, order_id, 'refund') entry is the gate
      const ent = await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key)
        VALUES (${hold.company_id}, ${hold.id}, ${brand}, ${order_id}, ${hold.order_number}, 'refund', ${-amt}, 0, ${hold.period_day_key}, ${hold.period_month_key})
        ON CONFLICT (brand, order_id, entry_type) DO NOTHING
        RETURNING id`);
      if (ent.length === 0) { ok = true; return; } // already refunded — replay ok
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET posted = posted - ${amt}, version = version + 1, updated_at = now()
        WHERE company_id = ${hold.company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`UPDATE credit_entries SET balance_after = ${acc[0].balance_after} WHERE id = ${ent[0].id}`);
      await reversePeriods(tx, hold.company_id, hold.period_day_key, hold.period_month_key, amt);
      ok = true;
    });
    return { ok };
  } catch (e) { console.error("credit.refund", e); return { ok: false, reason: "service_error" }; }
}

export async function applyPayment(db: DrizzleDb, company_id: string, amount: number, meta: { doc_number?: string; doc_date?: Date; note?: string; created_by?: string }): Promise<OpResult> {
  if (!(amount > 0)) return { ok: false, reason: "bad_amount" };
  try {
    await db.transaction(async (tx: DrizzleDb) => {
      // GOTCHA: postgres.js cannot bind a raw JS Date through drizzle's sql`` template
      // (throws in bytes.js) — always convert to an ISO string, or pass null.
      const docDate = meta.doc_date ? meta.doc_date.toISOString() : null;
      await tx.execute(sql`
        INSERT INTO credit_payments (company_id, amount, doc_number, doc_date, note, created_by)
        VALUES (${company_id}, ${amount}, ${meta.doc_number ?? null}, ${docDate}, ${meta.note ?? null}, ${meta.created_by ?? null})`);
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET posted = posted - ${amount}, version = version + 1, updated_at = now()
        WHERE company_id = ${company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, entry_type, amount, balance_after, created_by)
        VALUES (${company_id}, 'payment', ${-amount}, ${acc[0].balance_after}, ${meta.created_by ?? null})`);
    });
    return { ok: true };
  } catch (e) { console.error("credit.payment", e); return { ok: false, reason: "service_error" }; }
}
