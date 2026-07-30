import { and, eq, sql } from "drizzle-orm";
import * as s from "../../../drizzle/schema";
import type { CreditDb } from "./db";
import type { AuthorizeInput, AuthorizeResult, DeclineReason, OpResult } from "./types";

// TODO: the pre-existing functions below still take `any` — narrowing them to
// CreditDb makes every `${-hold.amount}` / `Number(row.spent)` on a raw
// `execute()` row a type error (raw rows are untyped), which is a mechanical but
// large edit with no CI payoff today (package.json has no typecheck script).
// New functions (amendHold, applyAdjustment) take CreditDb directly.
export type DrizzleDb = any; // matches ctx drizzle instance type used across modules

const TZ = "Asia/Tashkent";
export const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // sv-SE => YYYY-MM-DD
export const monthKey = (d: Date) => dayKey(d).slice(0, 7);

// Config cache for the hot-path phone->company lookup. Never a correctness
// dependency: creditRedis defaults to null (cache bypass, direct SELECT — same
// behavior as before this cache existed), and any redis error on get/setex is
// caught and falls through to the DB. Only company config (id/name/status/
// limit_*) is cached here — balances (posted/reserved) are never touched by
// this cache and are always read fresh inside authorize()'s transaction.
let creditRedis: any = null;
export const setCreditRedis = (r: any) => { creditRedis = r; };
const CACHE_KEY = (phone: string) => `credit:company_by_phone:${phone}`;
const CACHE_TTL = 60; // seconds — backstop only; writes must invalidate
const INVALIDATE_TIMEOUT_MS = 250;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// Contract for callers (Plan 2's admin CRUD): ANY write to credit_companies
// (status/limits) or credit_company_phones (add/deactivate/renumber) MUST call
// this with every phone affected by the change — including a newly ADDED
// phone. "Invalidate on suspend/limit-change" is the intuitive case; the one
// Plan 2 will likely forget is invalidate-on-ADD: resolveCompanyByPhone caches
// negative lookups too (see below), so a phone that was queried even once
// before being added to credit_company_phones stays cached as "no company" for
// up to 60s — the newly-added customer gets hard-declined (unknown_phone) at
// checkout despite being active in Postgres, not just a stale-approve risk.
//
// Invalidation itself is best-effort and bounded, NOT a synchronous guarantee:
// `redis.del` is raced against a ~250ms timeout so a slow/degraded (not fully
// down) redis can never hang the calling admin request — this module has no
// control over what shape of redis client Plan 2 passes in (it may default
// enableOfflineQueue:true with no commandTimeout, which queues indefinitely on
// an outage rather than rejecting; the credit module's own cache client uses a
// fail-fast shape internally, but invalidateCreditCompanyCache's `redis` param
// comes from the caller, so this timeout is the only guard this function can
// provide). Both a timeout and a delete failure are swallowed (logged, not
// thrown) — a caller must never treat a resolved promise here as proof the
// stale key is actually gone; the 60s TTL is the real backstop for both a
// dropped invalidation and this timeout.
export async function invalidateCreditCompanyCache(redis: any, phones: string[]) {
  if (!phones.length) return;
  try {
    // canonPhone here mirrors resolveCompanyByPhone's key derivation exactly: an
    // admin passing "998901234567" must delete the key written for "+998901234567".
    await withTimeout(redis.del(...phones.map((p) => CACHE_KEY(canonPhone(p)))), INVALIDATE_TIMEOUT_MS);
  } catch (e) {
    console.error(`credit cache invalidation failed or timed out after ${INVALIDATE_TIMEOUT_MS}ms (TTL will still expire it)`, e);
  }
}

// Canonical phone form for this module is E.164-with-plus: `+998XXXXXXXXX`.
// credit_company_phones.phone is stored that way and is uniquely indexed, so the
// read path stays a single indexed equality lookup — deliberately NOT a
// regexp_replace() comparison, which would make credit_phone_uniq unusable and
// turn every checkout into a seq scan.
//
// The normalization here is therefore narrow on purpose: strip formatting, and
// only rewrite shapes that are unambiguously the canonical number written
// differently ("998901234567", "+998 90 123 45 67"). Anything else is passed
// through untouched and simply won't match — a phone stored in some other form
// is a data-entry bug for Plan 2's admin UI to fix at WRITE time, not something
// to paper over here with a fallback scan.
export function canonPhone(phone: string): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("998")) return `+${digits}`;
  return phone;
}

export async function resolveCompanyByPhone(db: DrizzleDb, rawPhone: string) {
  // canonicalize before BOTH the cache key and the SQL compare, or the same
  // customer under two spellings gets two cache entries and one of them misses.
  const phone = canonPhone(rawPhone);
  const key = CACHE_KEY(phone);

  if (creditRedis) {
    try {
      const cached = await creditRedis.get(key);
      if (cached !== null && cached !== undefined) return JSON.parse(cached);
    } catch (e) {
      console.error("credit cache read failed, falling back to DB", e);
    }
  }

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
  const row = rows[0] ?? null;

  if (creditRedis) {
    try {
      // Negative results are cached as the literal 4-char string "null" (a valid
      // JSON null literal), NOT JSON.stringify of the string "null" — the latter
      // would round-trip through JSON.parse as the truthy string "null" instead
      // of the falsy `null`, making an unknown phone look like a company with
      // status === undefined. This is what makes unknown-phone spam cheap.
      await creditRedis.setex(key, CACHE_TTL, row ? JSON.stringify(row) : "null");
    } catch (e) {
      console.error("credit cache write failed", e);
    }
  }

  return row;
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
  // Integer check lives here, not only in internal-app.ts's t.Integer schema:
  // Plan 2's admin code calls service.ts directly and never crosses the socket,
  // so the schema is not a boundary it passes through. A fractional amount would
  // otherwise reach a bigint column and abort the transaction mid-flight.
  if (!(Number.isInteger(input.amount) && input.amount > 0)) return { approved: false, reason: "service_error" };

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
          SELECT id, state, company_id, amount FROM credit_holds WHERE brand = ${input.brand} AND order_id = ${input.order_id}`);
        // Check order is load-bearing: state -> company -> amount. A re-authorize
        // of a VOIDED order is a caller bug regardless of amount, and a
        // cross-company collision must never be reported as an amount problem.
        if (ex.length && ex[0].state !== "voided" && ex[0].state !== "expired") {
          if (ex[0].company_id !== company.id) {
            // this phone resolves to a different company than the one that already
            // owns the hold — never approve under a company that doesn't own it
            decline = "service_error";
            throw new Error("rollback");
          }
          // Same order, different money: Laravel changed the composition and must
          // call /amend. Silently returning the OLD hold here (the pre-fix
          // behavior) would leave the customer reserved for the old total forever.
          // Number(): bigint columns come back from raw execute() as strings.
          if (Number(ex[0].amount) !== input.amount) {
            decline = "amount_mismatch";
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
    let result: OpResult = { ok: false };
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        UPDATE credit_holds SET state='captured', updated_at=now()
        WHERE brand=${brand} AND order_id=${order_id} AND state='held'
        RETURNING id, company_id, amount, order_number, period_day_key, period_month_key`);
      if (h.length === 0) {
        const ex = await tx.execute(sql`SELECT state FROM credit_holds WHERE brand=${brand} AND order_id=${order_id}`);
        if (ex.length === 0) { result = { ok: false, reason: "not_found" }; return; }
        if (ex[0].state === "captured") { result = { ok: true }; return; } // replay
        result = { ok: false, state: ex[0].state, reason: "wrong_state" }; // voided/expired
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
      result = { ok: true };
    });
    return result;
  } catch (e) { console.error("credit.capture", e); return { ok: false, reason: "service_error" }; }
}

// LOCK ORDER: callers must already hold the credit_accounts row lock for this
// company (i.e. have run their `UPDATE credit_accounts ... WHERE company_id`)
// before calling this. Every write path in this file takes accounts -> periods,
// and two paths taking those locks in opposite orders is exactly how a pair of
// concurrent orders for one company deadlocks.
async function reversePeriods(tx: DrizzleDb, company_id: string, dk: string, mk: string, amount: number) {
  // floor at 0 per spec
  await tx.execute(sql`UPDATE credit_periods SET spent = GREATEST(0, spent - ${amount}) WHERE company_id=${company_id} AND period_key IN (${dk}, ${mk})`);
}

export async function voidHold(db: DrizzleDb, brand: string, order_id: string, opts?: { as?: "voided" | "expired" }): Promise<OpResult> {
  const target = opts?.as ?? "voided";
  try {
    let result: OpResult = { ok: false };
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        UPDATE credit_holds SET state=${target}::credit_hold_state, updated_at=now()
        WHERE brand=${brand} AND order_id=${order_id} AND state='held'
        RETURNING id, company_id, amount, order_number, period_day_key, period_month_key`);
      if (h.length === 0) {
        const ex = await tx.execute(sql`SELECT state FROM credit_holds WHERE brand=${brand} AND order_id=${order_id}`);
        if (ex.length === 0) { result = { ok: false, reason: "not_found" }; return; }
        if (ex[0].state === "voided" || ex[0].state === "expired") { result = { ok: true }; return; } // replay
        result = { ok: false, state: ex[0].state, reason: "wrong_state" }; // e.g. captured: void no longer applies, use refund
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
      result = { ok: true };
    });
    return result;
  } catch (e) { console.error("credit.void", e); return { ok: false, reason: "service_error" }; }
}

// Changes the amount of a hold that is still 'held'. This is the operation
// Laravel's resend-composition flow needs: it edits an EXISTING order (same
// orders.id) to a new total, and neither authorize (idempotent on the order id,
// ignores a changed amount — now declines it as amount_mismatch) nor
// void+re-authorize (re-authorizing a voided order id is a caller bug by design)
// can express that.
//
// PERIOD ATTRIBUTION: the delta is charged to the HOLD's OWN period keys, not to
// today's. For the ~100% case (amend on the same day the order was placed) these
// are the same keys. They differ only when an amend crosses midnight (or a month
// boundary), and there charging "today" would be actively wrong: the release path
// below reverses against the hold's original keys, so an amend up on day 2
// followed by an amend down would inflate day 2's counter permanently while
// double-decrementing day 1. Original-key attribution is also what makes
// reconcileAccounts' period re-derivation exact — it derives expected spend from
// the (already amended) hold amount sitting on the hold's own keys. limit_total
// is always evaluated against live balances, and a hold's lifetime is bounded by
// expires_at plus the reaper, so the exposure window here is at most a day.
export async function amendHold(db: CreditDb, brand: string, order_id: string, new_amount: number): Promise<OpResult> {
  if (!(Number.isInteger(new_amount) && new_amount > 0)) return { ok: false, reason: "bad_amount" };

  let decline: string | null = null;
  try {
    let result: OpResult = { ok: false };
    await db.transaction(async (tx: DrizzleDb) => {
      // FOR UPDATE serializes concurrent amends on the same order: without it two
      // amends both read the old amount and the second one's delta is computed
      // against a stale base (lost update). Taking the hold row first also keeps
      // this path's lock order identical to authorize's (hold -> accounts ->
      // period day -> period month).
      const h = await tx.execute(sql`
        SELECT id, company_id, amount, order_number, state, period_day_key, period_month_key
        FROM credit_holds WHERE brand=${brand} AND order_id=${order_id} FOR UPDATE`);
      if (h.length === 0) { result = { ok: false, reason: "not_found" }; return; }
      const hold = h[0];
      // captured/voided/expired: the money has already moved (or been released);
      // a captured order is corrected with refund, not amend.
      if (hold.state !== "held") { result = { ok: false, state: hold.state, reason: "wrong_state" }; return; }

      const prev_amount = Number(hold.amount);
      const delta = new_amount - prev_amount;
      // Replay: an amend that restates the amount the hold already carries is a
      // no-op success. This — not a unique ledger entry — is what makes /amend
      // safe to retry, because successive amends to DIFFERENT amounts are all
      // legal and each writes its own entry.
      if (delta === 0) { result = { ok: true }; return; }

      const dk = hold.period_day_key as string, mk = hold.period_month_key as string;
      const [company] = await tx.execute(sql`
        SELECT status, limit_daily, limit_monthly FROM credit_companies WHERE id = ${hold.company_id}`);

      let balance_after: unknown;
      if (delta > 0) {
        // Growing the exposure of a company that is no longer active is the same
        // risk authorize declines outright — Laravel must refuse the composition
        // change. Shrinking (delta < 0) always stays allowed.
        if (company.status !== "active") { decline = "suspended"; throw new Error("rollback"); }
        // All three ceilings apply to the delta exactly as they would to a new
        // order of that size — same conditional-UPDATE + upsert-with-limit-WHERE
        // shape as authorize, so a decline anywhere rolls the whole thing back.
        const acc = await tx.execute(sql`
          UPDATE credit_accounts a
          SET reserved = a.reserved + ${delta}, version = a.version + 1, updated_at = now()
          FROM credit_companies c
          WHERE a.company_id = ${hold.company_id} AND c.id = a.company_id
            AND c.limit_total - a.posted - a.reserved >= ${delta}
          RETURNING a.posted + a.reserved AS balance_after`);
        if (acc.length === 0) { decline = "limit_total"; throw new Error("rollback"); }
        if (!(await bumpPeriod(tx, hold.company_id, dk, delta, Number(company.limit_daily), "limit_daily"))) { decline = "limit_daily"; throw new Error("rollback"); }
        if (!(await bumpPeriod(tx, hold.company_id, mk, delta, Number(company.limit_monthly), "limit_monthly"))) { decline = "limit_monthly"; throw new Error("rollback"); }
        balance_after = acc[0].balance_after;
      } else {
        const acc = await tx.execute(sql`
          UPDATE credit_accounts SET reserved = reserved + ${delta}, version = version + 1, updated_at = now()
          WHERE company_id = ${hold.company_id}
          RETURNING posted + reserved AS balance_after`);
        await reversePeriods(tx, hold.company_id, dk, mk, -delta);
        balance_after = acc[0].balance_after;
      }

      await tx.execute(sql`UPDATE credit_holds SET amount = ${new_amount}, updated_at = now() WHERE id = ${hold.id}`);
      // entry_type 'amend' rather than 'adjustment' on purpose: reconcileAccounts'
      // expected_posted sums payment/refund/adjustment, and an entry of that type
      // against a still-HELD hold would corrupt it. 'amend' moves reserve only,
      // which reconciliation already derives from credit_holds. The unique
      // (brand, order_id, entry_type) gate is partial and excludes 'amend' (see
      // migration 0012) precisely because repeated amends are legal.
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key, meta)
        VALUES (${hold.company_id}, ${hold.id}, ${brand}, ${order_id}, ${hold.order_number}, 'amend', ${delta}, ${balance_after}, ${dk}, ${mk},
                ${JSON.stringify({ prev_amount, new_amount })}::jsonb)`);
      result = { ok: true };
    });
    return result;
  } catch (e: any) {
    // bumpPeriod's fresh-INSERT-over-limit branch throws instead of returning
    // false; without this the correct limit_daily/limit_monthly reason would be
    // flattened into service_error (same handling as authorize).
    if (e?.fresh_over) decline = e.fresh_over as DeclineReason;
    if (decline) return { ok: false, reason: decline };
    console.error("credit.amend", e);
    return { ok: false, reason: "service_error" };
  }
}

export async function refund(db: DrizzleDb, brand: string, order_id: string, amount?: number): Promise<OpResult> {
  // CRITICAL: reject before touching the DB. A negative amount would increase
  // `posted` and inflate periods via GREATEST(0, spent - (-amt)) undetected by
  // reconciliation; a zero amount would insert a 0-amount 'refund' entry that
  // permanently occupies the (brand, order_id, 'refund') unique slot, silently
  // no-opping every real refund attempt made after it.
  if (amount !== undefined && !(amount > 0 && Number.isInteger(amount))) return { ok: false, reason: "bad_amount" };
  try {
    let result: OpResult = { ok: false };
    await db.transaction(async (tx: DrizzleDb) => {
      const h = await tx.execute(sql`
        SELECT id, company_id, amount, order_number, period_day_key, period_month_key, state
        FROM credit_holds WHERE brand=${brand} AND order_id=${order_id}`);
      if (h.length === 0) { result = { ok: false, reason: "not_found" }; return; }
      const hold = h[0];
      if (hold.state !== "captured") { result = { ok: false, state: hold.state, reason: "wrong_state" }; return; }
      const amt = Math.min(amount ?? Number(hold.amount), Number(hold.amount));
      // idempotency: unique (brand, order_id, 'refund') entry is the gate
      const ent = await tx.execute(sql`
        INSERT INTO credit_entries (company_id, hold_id, brand, order_id, order_number, entry_type, amount, balance_after, period_day_key, period_month_key)
        VALUES (${hold.company_id}, ${hold.id}, ${brand}, ${order_id}, ${hold.order_number}, 'refund', ${-amt}, 0, ${hold.period_day_key}, ${hold.period_month_key})
        ON CONFLICT (brand, order_id, entry_type) DO NOTHING
        RETURNING id`);
      if (ent.length === 0) {
        // conflict: a refund entry already exists. Only a same-amount replay is a
        // true no-op; a different amount means the caller is asking for a second,
        // distinct partial refund that the schema (one refund entry per order) can't
        // represent — must be reported, not silently swallowed as success.
        const existing = await tx.execute(sql`
          SELECT amount FROM credit_entries WHERE brand=${brand} AND order_id=${order_id} AND entry_type='refund'`);
        if (existing.length > 0 && Number(existing[0].amount) === -amt) { result = { ok: true }; return; }
        result = { ok: false, reason: "already_refunded_different_amount" };
        return;
      }
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET posted = posted - ${amt}, version = version + 1, updated_at = now()
        WHERE company_id = ${hold.company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`UPDATE credit_entries SET balance_after = ${acc[0].balance_after} WHERE id = ${ent[0].id}`);
      await reversePeriods(tx, hold.company_id, hold.period_day_key, hold.period_month_key, amt);
      result = { ok: true };
    });
    return result;
  } catch (e) { console.error("credit.refund", e); return { ok: false, reason: "service_error" }; }
}

export async function applyPayment(db: DrizzleDb, company_id: string, amount: number, meta: { doc_number?: string; doc_date?: Date; note?: string; created_by?: string }): Promise<OpResult> {
  if (!(Number.isInteger(amount) && amount > 0)) return { ok: false, reason: "bad_amount" };
  try {
    let result: OpResult = { ok: true };
    await db.transaction(async (tx: DrizzleDb) => {
      // A payment for a company that has never ordered has no accounts row yet;
      // without this the UPDATE below matches nothing and acc[0] blows up.
      await ensureAccount(tx, company_id);
      // GOTCHA: postgres.js cannot bind a raw JS Date through drizzle's sql`` template
      // (throws in bytes.js) — always convert to an ISO string, or pass null.
      const docDate = meta.doc_date ? meta.doc_date.toISOString() : null;
      // Idempotency gate = the payment document. A double-submitted admin form (or
      // a retried request) must not debit twice, and (company_id, doc_number) is
      // the only natural key a bank payment has. The WHERE clause repeats the
      // index predicate because arbiter inference on a PARTIAL unique index
      // requires it (credit_payment_doc_uniq, migration 0012).
      //
      // doc_number is still nullable, and a NULL never conflicts — such a payment
      // has NO replay protection at all. Plan 2's admin UI must always pass a
      // doc_number; treat the null case as a legacy/manual escape hatch.
      const ins = await tx.execute(sql`
        INSERT INTO credit_payments (company_id, amount, doc_number, doc_date, note, created_by)
        VALUES (${company_id}, ${amount}, ${meta.doc_number ?? null}, ${docDate}, ${meta.note ?? null}, ${meta.created_by ?? null})
        ON CONFLICT (company_id, doc_number) WHERE doc_number IS NOT NULL DO NOTHING
        RETURNING id`);
      if (ins.length === 0) { result = { ok: true, reason: "duplicate_doc" }; return; } // replay: no second debit
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET posted = posted - ${amount}, version = version + 1, updated_at = now()
        WHERE company_id = ${company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, entry_type, amount, balance_after, meta, created_by)
        VALUES (${company_id}, 'payment', ${-amount}, ${acc[0].balance_after},
                ${JSON.stringify({ payment_id: ins[0].id, doc_number: meta.doc_number ?? null, doc_date: docDate })}::jsonb,
                ${meta.created_by ?? null})`);
    });
    return result;
  } catch (e) { console.error("credit.payment", e); return { ok: false, reason: "service_error" }; }
}

// Manual correction of a company's debt, for Plan 2's admin UI (write-offs,
// disputed charges, opening balances).
//
// SIGN CONVENTION, matching applyPayment: a POSITIVE amount REDUCES debt
// (posted -= amount) and writes a ledger entry of -amount; a NEGATIVE amount
// increases debt. Reading the ledger, an entry's sign is always "what this did to
// the balance", so reconcileAccounts can keep summing payment/refund/adjustment
// amounts unchanged.
export async function applyAdjustment(db: CreditDb, company_id: string, amount: number, meta: { reason: string; created_by?: string }): Promise<OpResult> {
  if (!Number.isInteger(amount) || amount === 0) return { ok: false, reason: "bad_amount" };
  // An unexplained manual balance change is not auditable, which is the entire
  // point of this function existing instead of a hand-run UPDATE.
  if (!meta?.reason?.trim()) return { ok: false, reason: "bad_reason" };
  try {
    let result: OpResult = { ok: true };
    await db.transaction(async (tx: DrizzleDb) => {
      const c = await tx.execute(sql`SELECT id FROM credit_companies WHERE id = ${company_id}`);
      if (c.length === 0) { result = { ok: false, reason: "not_found" }; return; }
      await ensureAccount(tx, company_id);
      const acc = await tx.execute(sql`
        UPDATE credit_accounts SET posted = posted - ${amount}, version = version + 1, updated_at = now()
        WHERE company_id = ${company_id}
        RETURNING posted + reserved AS balance_after`);
      await tx.execute(sql`
        INSERT INTO credit_entries (company_id, entry_type, amount, balance_after, meta, created_by)
        VALUES (${company_id}, 'adjustment', ${-amount}, ${acc[0].balance_after},
                ${JSON.stringify({ reason: meta.reason, created_by: meta.created_by ?? null })}::jsonb,
                ${meta.created_by ?? null})`);
    });
    return result;
  } catch (e) { console.error("credit.adjustment", e); return { ok: false, reason: "service_error" }; }
}
