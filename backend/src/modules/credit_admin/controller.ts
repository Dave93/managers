import { credit_accounts, credit_companies, credit_company_documents, credit_company_phones, credit_entries, credit_payments, credit_periods } from "backend/drizzle/schema";
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { getCreditDb } from "../credit/db";
import { applyAdjustment, applyPayment, canonPhone, dayKey, ensureAccount, invalidateCreditCompanyCache, monthKey } from "../credit/service";
import { and, desc, eq, gt, gte, inArray, lte, SQLWrapper, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import fs from "fs";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";

// db/redis are typed `any` here on purpose: the route passes ctx's node-postgres
// `drizzle` + ioredis `redis`, tests pass a drizzle-orm/postgres-js handle + a
// stub recording `del` calls. Only plain ORM insert/update/select is done with
// `db` here — no raw `.execute()` — so the driver-shape hazard documented in
// modules/credit/db.ts does not apply. `ensureAccount` (a service.ts function)
// always goes through `getCreditDb()`, never the `db` passed in, per CONTRACT.md.
export async function createCompany(db: any, redis: any, input: any, userId: string) {
  const phone = input.phone ? canonPhone(input.phone) : null;
  // Explicit field picks (not a `{...input}` spread): the route's TypeBox
  // schema already constrains `data` to these fields, but picking them out
  // by name here removes the question of what an unexpected extra key on
  // `input` would do at the DB layer entirely, rather than relying on the
  // schema being airtight upstream.
  const [row] = await db
    .insert(credit_companies)
    .values({
      name: input.name,
      inn: input.inn,
      status: input.status,
      limit_total: input.limit_total,
      limit_daily: input.limit_daily,
      limit_monthly: input.limit_monthly,
      phone,
    })
    .returning();
  await ensureAccount(getCreditDb(), row.id);
  if (phone) await invalidateCreditCompanyCache(redis, [phone]);
  return row;
}

export async function updateCompany(db: any, redis: any, id: string, input: any, userId: string) {
  // Read the pre-update row: the primary `phone` field can change in this same
  // call, and the OLD value must be invalidated too, or a changed A->B primary
  // phone leaves key A wrongly resolvable for up to the 60s cache TTL. Also
  // read verified_at here (not after the update) so the once-only guard below
  // checks the state that existed BEFORE this call, not a value this same
  // UPDATE is about to set.
  const [existing] = await db
    .select({ phone: credit_companies.phone, verified_at: credit_companies.verified_at })
    .from(credit_companies)
    .where(eq(credit_companies.id, id));

  // Explicit field picks (not a `{...input}` spread) — same rationale as
  // createCompany above. Only assigns a key when the caller actually sent
  // it, preserving PUT's partial-update semantics (an omitted field must
  // leave the existing column value untouched, not overwrite it with
  // undefined).
  const patch: any = { updated_at: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.inn !== undefined) patch.inn = input.inn;
  if (input.phone !== undefined) patch.phone = canonPhone(input.phone);
  if (input.status !== undefined) patch.status = input.status;
  if (input.limit_total !== undefined) patch.limit_total = input.limit_total;
  if (input.limit_daily !== undefined) patch.limit_daily = input.limit_daily;
  if (input.limit_monthly !== undefined) patch.limit_monthly = input.limit_monthly;
  // verified_by/verified_at stamp once: a second `verified:true` on an already-
  // verified company must not overwrite the original verifier/timestamp — it's
  // an audit trail, not a toggle. No-op (not an error) when already verified.
  if (input.verified === true && !existing?.verified_at) {
    patch.verified_by = userId;
    patch.verified_at = new Date();
  }
  const [row] = await db.update(credit_companies).set(patch).where(eq(credit_companies.id, id)).returning();

  // Invalidate every phone the change could affect: every row in
  // credit_company_phones for this company, credit_companies.phone's NEW value
  // (a separate, single "primary contact" field), and its OLD value if it just
  // changed — a status/limit change can gate checkout for any of them, and a
  // changed primary phone must drop both the stale and the new cache entry.
  const phones = await db
    .select({ phone: credit_company_phones.phone })
    .from(credit_company_phones)
    .where(eq(credit_company_phones.company_id, id));
  const allPhones = phones.map((p: any) => p.phone)
    .concat(row.phone ? [row.phone] : [])
    .concat(existing?.phone && existing.phone !== row.phone ? [existing.phone] : []);
  if (allPhones.length) await invalidateCreditCompanyCache(redis, allPhones);

  return row;
}

// `credit_phone_uniq` is a GLOBAL unique index across all companies. A
// duplicate insert throws a postgres unique-violation (23505), not a business
// `{approved:false}`-shaped result — caught here and turned into
// `{error:"phone_taken"}` so the route answers 400, not a 500. Only the newly
// ADDED phone is invalidated: per CONTRACT.md, negative lookups are cached too,
// so a phone queried once before being added stays cached as "no company" for
// up to the 60s TTL — a false DECLINE at checkout for the new number, not
// merely a stale approve.
export async function addPhone(db: any, redis: any, companyId: string, input: any) {
  const phone = canonPhone(input.phone);
  let row: any;
  try {
    [row] = await db
      .insert(credit_company_phones)
      .values({ company_id: companyId, phone, employee_name: input.employee_name ?? null })
      .returning();
  } catch (e: any) {
    if (e?.code === "23505" || e?.cause?.code === "23505") return { error: "phone_taken" };
    throw e;
  }
  // Invalidation lives OUTSIDE the insert's try/catch and in its own: the
  // insert already succeeded by this point, so a redis failure here must
  // never surface as a 500 on a row that is already committed, and it must
  // never be mistaken for the unrelated 23505 case above (which would answer
  // `phone_taken` for a phone that in fact was just added). Best-effort per
  // CONTRACT.md — the cache TTL is the real backstop.
  try {
    await invalidateCreditCompanyCache(redis, [phone]);
  } catch (e) {
    console.error("addPhone: cache invalidation failed", e);
  }
  return row;
}

export async function deactivatePhone(db: any, redis: any, id: string, active: boolean) {
  const [row] = await db
    .update(credit_company_phones)
    .set({ active })
    .where(eq(credit_company_phones.id, id))
    .returning();
  if (row) await invalidateCreditCompanyCache(redis, [row.phone]);
  return row;
}

const UPLOAD_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Read at call time (not module load) so tests can point CREDIT_UPLOADS_DIR at
// a temp dir via process.env before calling saveDocument/deleteDocument.
function uploadsBase() {
  return process.env.CREDIT_UPLOADS_DIR ?? "/home/davr/managers/uploads/credit";
}

function extOf(filename: string) {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

// Content-Disposition header value: doc_number is admin-entered free text and
// must never be interpolated raw into a header — a value containing quotes or
// CRLF could break out of the quoted filename token or inject additional
// header fields. Keep only characters that are unambiguously safe there;
// callers fall back to doc.id (always a UUID) when the result is empty.
export function sanitizeFilenamePart(raw: string): string {
  return String(raw ?? "").replace(/[^A-Za-z0-9._-]/g, "");
}

// Ext allowlist + size cap are checked BEFORE anything touches the filesystem
// or DB, so a rejected upload never leaves a partial file or an orphan row.
export async function saveDocument(db: any, companyId: string, file: any, meta: any) {
  if (file.size > MAX_UPLOAD_BYTES) return { error: "too_large" };
  const ext = extOf(file.name ?? "");
  if (!UPLOAD_EXTS.includes(ext)) return { error: "bad_type" };

  // companyId flows straight into a filesystem path below (`${base}/${companyId}`).
  // Verifying the company exists BEFORE any disk touch also kills path
  // traversal (`id=".."`) for free: comparing a non-UUID string against a
  // `uuid` column makes postgres throw 22P02 (invalid_text_representation),
  // caught here and folded into the same company_not_found result instead of
  // a raw 500. The catch is narrowed to that specific code (not a bare catch)
  // so a genuine DB error — connection drop, timeout — surfaces as a 500
  // instead of silently misreporting as "company doesn't exist". Route-level
  // t.String({format:"uuid"}) params catch the common case earlier (422);
  // this is the belt-and-braces layer for the helper itself, since anything
  // can call saveDocument directly.
  let company;
  try {
    [company] = await db.select({ id: credit_companies.id }).from(credit_companies).where(eq(credit_companies.id, companyId));
  } catch (e: any) {
    if (e?.code === "22P02" || e?.cause?.code === "22P02") return { error: "company_not_found" };
    throw e;
  }
  if (!company) return { error: "company_not_found" };

  // drizzle's `timestamp` column builder calls `.toISOString()` on the value
  // it's given (unlike the raw-sql path elsewhere in this module, which takes
  // ISO strings directly) — a plain string here throws a TypeError deep inside
  // pg-core, not a validation error. Convert and validate before anything
  // touches disk, so a bad date never leaves an orphan file behind.
  let doc_date: Date | null = null;
  if (meta.doc_date) {
    doc_date = new Date(meta.doc_date);
    if (isNaN(doc_date.getTime())) return { error: "bad_date" };
  }

  const dir = `${uploadsBase()}/${companyId}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const filePath = `${dir}/${randomUUID()}${ext}`;
  await Bun.write(filePath, file);

  try {
    const [row] = await db
      .insert(credit_company_documents)
      .values({
        company_id: companyId,
        type: meta.type,
        file_path: filePath,
        doc_number: meta.doc_number ?? null,
        doc_date,
        uploaded_by: meta.uploaded_by ?? null,
      })
      .returning();
    return row;
  } catch (e) {
    // the file already landed on disk before this insert; on failure it must
    // not become an orphan with no DB row ever pointing to it.
    try {
      fs.unlinkSync(filePath);
    } catch {}
    console.error("saveDocument: insert failed, cleaned up orphan file", e);
    return { error: "save_failed" };
  }
}

export async function deleteDocument(db: any, id: string) {
  const [doc] = await db.select().from(credit_company_documents).where(eq(credit_company_documents.id, id));
  if (!doc) return { error: "not_found" };
  // DB row first, then unlink: if the unlink throws (anything but ENOENT),
  // failing AFTER the row is already gone leaves a recoverable orphan file
  // on disk (cleanable out-of-band) rather than the reverse order's failure
  // mode — an orphan DB row whose file_path no longer resolves, which is a
  // permanent 410 the next time someone tries to download it.
  await db.delete(credit_company_documents).where(eq(credit_company_documents.id, id));
  try {
    fs.unlinkSync(doc.file_path);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e; // tolerate a file that already vanished out-of-band
  }
  return { ok: true };
}

// Money moves through applyPayment/applyAdjustment only, per CONTRACT.md — both
// ALWAYS go through getCreditDb(), never a caller-supplied `db` (unlike every
// other helper above, which takes ctx's drizzle for plain reads/writes on
// non-money tables). Passing the wrong handle here doesn't throw a clear
// error, it silently turns money operations into `service_error` (see
// modules/credit/db.ts). The route returns the OpResult verbatim, including
// the `{ok:true, reason:"duplicate_doc"}` replay shape — that IS success, not
// a case to special-case into an error.
export async function payCompany(companyId: string, data: any, userId?: string) {
  return applyPayment(getCreditDb(), companyId, data.amount, {
    doc_number: data.doc_number,
    doc_date: data.doc_date ? new Date(data.doc_date) : undefined,
    note: data.note,
    created_by: userId,
  });
}

export async function adjustCompany(companyId: string, data: any, userId?: string) {
  return applyAdjustment(getCreditDb(), companyId, data.amount, { reason: data.reason, created_by: userId });
}

export async function listPayments(db: any, companyId: string) {
  // Explicit column list, matching the documents/companies list routes above.
  const data = await db
    .select({
      id: credit_payments.id,
      company_id: credit_payments.company_id,
      amount: credit_payments.amount,
      doc_number: credit_payments.doc_number,
      doc_date: credit_payments.doc_date,
      note: credit_payments.note,
      created_by: credit_payments.created_by,
      created_at: credit_payments.created_at,
    })
    .from(credit_payments)
    .where(eq(credit_payments.company_id, companyId))
    .orderBy(desc(credit_payments.created_at));
  return { data };
}

// Exported (not just used inline by the export route) so it's directly
// testable at the same level as the rest of this module's helpers.
export async function companyExists(db: any, companyId: string): Promise<boolean> {
  const [row] = await db.select({ id: credit_companies.id }).from(credit_companies).where(eq(credit_companies.id, companyId));
  return !!row;
}

// Bare `YYYY-MM-DD` query params (what a date-only <input type=date> sends)
// must be interpreted in Tashkent local time, matching dayKey/monthKey — NOT
// `new Date("YYYY-MM-DD")`, which JS parses as UTC midnight (Tashkent is
// UTC+5). Left as UTC midnight, `to=2026-07-30` would cut off at 05:00
// Tashkent instead of end-of-day, silently dropping the last ~19 hours of
// that day's entries; `from=2026-07-30` would likewise drop entries made
// between 00:00-05:00 Tashkent (whose UTC timestamp is still the previous
// UTC day). A full ISO timestamp (already carrying its own offset/zone) is
// passed through untouched.
const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseStatementBound(value: string, endOfDay: boolean): Date {
  if (BARE_DATE_RE.test(value)) return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+05:00`);
  return new Date(value);
}

// Shared by the statement route and its xlsx export so the two can never drift
// apart on filtering/ordering. Callers pass `limit`/`offset` explicitly: the
// export path always calls with (STATEMENT_EXPORT_CAP, 0); the paginated JSON
// route calls with whatever the caller asked for, clamped to that same cap.
async function queryStatementEntries(
  db: any,
  companyId: string,
  filters: { from?: string; to?: string; brand?: string },
  limit: number,
  offset: number
) {
  const whereClause: SQLWrapper[] = [eq(credit_entries.company_id, companyId)];
  if (filters.from) whereClause.push(gte(credit_entries.created_at, parseStatementBound(filters.from, false)));
  if (filters.to) whereClause.push(lte(credit_entries.created_at, parseStatementBound(filters.to, true)));
  // credit_entries.brand is a Postgres enum ("chopar" | "les"); the query
  // param itself is validated no further than t.String() at the route, so
  // this cast doesn't change runtime behavior — an out-of-enum value still
  // fails at the DB the same way it did before this was a type error.
  if (filters.brand) whereClause.push(eq(credit_entries.brand, filters.brand as "chopar" | "les"));

  const [cnt] = await db.select({ count: sql<number>`count(*)` }).from(credit_entries).where(and(...whereClause));
  // Explicit column list, matching the documents/companies list routes above.
  const data = await db
    .select({
      id: credit_entries.id,
      company_id: credit_entries.company_id,
      hold_id: credit_entries.hold_id,
      brand: credit_entries.brand,
      order_id: credit_entries.order_id,
      order_number: credit_entries.order_number,
      entry_type: credit_entries.entry_type,
      amount: credit_entries.amount,
      balance_after: credit_entries.balance_after,
      period_day_key: credit_entries.period_day_key,
      period_month_key: credit_entries.period_month_key,
      meta: credit_entries.meta,
      created_by: credit_entries.created_by,
      created_at: credit_entries.created_at,
    })
    .from(credit_entries)
    .where(and(...whereClause))
    .orderBy(desc(credit_entries.created_at), desc(credit_entries.id))
    .limit(limit)
    .offset(offset);
  return { total: Number(cnt.count), data };
}

// posted/reserved from credit_accounts, day/month spend from credit_periods
// keyed on TODAY's dayKey/monthKey (not the statement's from/to filter — "how
// much room is left right now" is always relative to today, independent of
// what date range the admin happens to be browsing). Returns null when the
// company itself doesn't exist, so callers can 404 instead of silently
// answering an all-zero summary for a bad id.
export async function getStatementSummary(db: any, companyId: string) {
  const [company] = await db
    .select({ limit_total: credit_companies.limit_total, limit_daily: credit_companies.limit_daily, limit_monthly: credit_companies.limit_monthly })
    .from(credit_companies)
    .where(eq(credit_companies.id, companyId));
  if (!company) return null;

  const [account] = await db
    .select({ posted: credit_accounts.posted, reserved: credit_accounts.reserved })
    .from(credit_accounts)
    .where(eq(credit_accounts.company_id, companyId));

  const now = new Date();
  const dk = dayKey(now);
  const mk = monthKey(now);
  const periods = await db
    .select({ period_key: credit_periods.period_key, spent: credit_periods.spent })
    .from(credit_periods)
    .where(and(eq(credit_periods.company_id, companyId), inArray(credit_periods.period_key, [dk, mk])));

  const posted = account?.posted ?? 0;
  const reserved = account?.reserved ?? 0;
  const day_spent = periods.find((p: any) => p.period_key === dk)?.spent ?? 0;
  const month_spent = periods.find((p: any) => p.period_key === mk)?.spent ?? 0;
  const limit_total = company.limit_total ?? 0;
  const limit_daily = company.limit_daily ?? 0;
  const limit_monthly = company.limit_monthly ?? 0;

  const available = Math.max(
    0,
    Math.min(limit_total - posted - reserved, limit_daily - day_spent, limit_monthly - month_spent)
  );

  return { posted, reserved, available, day_spent, month_spent, limit_total, limit_daily, limit_monthly };
}

const STATEMENT_DEFAULT_LIMIT = 50;
const STATEMENT_EXPORT_CAP = 10_000;

export async function getStatement(db: any, companyId: string, query: any) {
  const summary = await getStatementSummary(db, companyId);
  if (!summary) return { error: "not_found" };
  // A non-numeric `limit`/`offset` (e.g. a hand-crafted request, or a client
  // bug) must fall back to the same defaults as an absent one, not propagate
  // NaN into `.limit()`/`.offset()` — Postgres would reject that query outright.
  const rawLimit = query.limit ? +query.limit : NaN;
  const limit = Number.isFinite(rawLimit) ? Math.min(rawLimit, STATEMENT_EXPORT_CAP) : STATEMENT_DEFAULT_LIMIT;
  const rawOffset = query.offset ? +query.offset : NaN;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
  const { total, data } = await queryStatementEntries(db, companyId, { from: query.from, to: query.to, brand: query.brand }, limit, offset);
  return { summary, total, data };
}

// Extracted so the truncation-marker branch is unit-testable without seeding
// 10,000+ real rows: callers can hand it a fabricated `total`.
//
// The xlsx is a human-facing document handed to accountants — everywhere else
// in this module (and in the JSON /statement route above) money stays in raw
// integer tiyins. This conversion to сумы (÷100) happens ONLY here.
export function buildStatementRows(entries: any[], total: number) {
  const rows = entries.map((e: any) => ({
    date: e.created_at,
    type: e.entry_type,
    brand: e.brand ?? "",
    order_number: e.order_number ?? "",
    amount: e.amount / 100,
    balance_after: e.balance_after / 100,
    doc: e.meta ? JSON.stringify(e.meta) : "",
  }));
  // A silent 10k cut mid-period is worse than an ugly row: without this, an
  // accountant reading the file has no signal that the statement they're
  // holding is incomplete. Keeps the same column keys as the data rows above
  // (not e.g. Cyrillic-cased keys) so json_to_sheet doesn't fork off extra
  // sparse columns for a row that only fills two of them.
  if (total > STATEMENT_EXPORT_CAP) {
    rows.push({
      date: "ВНИМАНИЕ",
      type: `выгружено ${STATEMENT_EXPORT_CAP} из ${total} — сузьте период`,
      brand: "",
      order_number: "",
      amount: "" as any,
      balance_after: "" as any,
      doc: "",
    });
  }
  return rows;
}

export async function exportStatementXlsx(db: any, companyId: string, query: any) {
  const { total, data } = await queryStatementEntries(db, companyId, { from: query.from, to: query.to, brand: query.brand }, STATEMENT_EXPORT_CAP, 0);
  const rows = buildStatementRows(data, total);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Statement");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

export async function getCreditSummary(db: any) {
  const [totalRow] = await db.select({ total_debt: sql<number>`coalesce(sum(${credit_accounts.posted}), 0)` }).from(credit_accounts);

  // posted > 0: a company that has never carried debt (or has since settled
  // to exactly 0) is not a "debtor" and must not clutter the top-5.
  const top_debtors = await db
    .select({ id: credit_companies.id, name: credit_companies.name, posted: credit_accounts.posted })
    .from(credit_accounts)
    .innerJoin(credit_companies, eq(credit_companies.id, credit_accounts.company_id))
    .where(gt(credit_accounts.posted, 0))
    .orderBy(desc(credit_accounts.posted))
    .limit(5);

  const mk = monthKey(new Date());
  const companies_over_80_monthly = await db
    .select({
      id: credit_companies.id,
      name: credit_companies.name,
      month_spent: credit_periods.spent,
      limit_monthly: credit_companies.limit_monthly,
    })
    .from(credit_periods)
    .innerJoin(credit_companies, eq(credit_companies.id, credit_periods.company_id))
    .where(
      and(
        eq(credit_periods.period_key, mk),
        sql`${credit_companies.limit_monthly} > 0`,
        sql`${credit_periods.spent} > 0.8 * ${credit_companies.limit_monthly}`
      )
    );

  return { total_debt: Number(totalRow.total_debt), companies_over_80_monthly, top_debtors };
}

// Registered on the app root (src/app.ts), not inside apiController's .use()
// chain: apiController was already at TypeScript's instantiation-depth limit
// (TS2589) with 44 controllers (see commit 6202a0c, the iiko_sync precedent),
// and this was the 45th — it silently overflowed tsc/next build (bun build's
// bundler doesn't typecheck, so Task 1 never caught it). Explicit /api prefix
// here (same as iikoSyncController/medicalController) since it no longer
// inherits apiController's prefix.
const creditAdminControllerImpl = new Elysia({
  name: "@api/credit_admin",
  prefix: "/api",
})
  .use(ctx)
  .get(
    "/credit/companies",
    async ({ query: { limit, offset, sort, filters }, drizzle }) => {
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) whereClause = parseFilterFields(filters, credit_companies, {});
      const cnt = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(credit_companies)
        .where(and(...whereClause))
        .execute();
      const data = await drizzle
        .select({
          id: credit_companies.id,
          name: credit_companies.name,
          inn: credit_companies.inn,
          phone: credit_companies.phone,
          status: credit_companies.status,
          overdue: credit_companies.overdue,
          limit_total: credit_companies.limit_total,
          limit_daily: credit_companies.limit_daily,
          limit_monthly: credit_companies.limit_monthly,
          verified_at: credit_companies.verified_at,
          posted: credit_accounts.posted,
          reserved: credit_accounts.reserved,
        })
        .from(credit_companies)
        .leftJoin(credit_accounts, eq(credit_accounts.company_id, credit_companies.id))
        .where(and(...whereClause))
        .orderBy(desc(credit_companies.created_at))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: cnt[0].count, data };
    },
    {
      permission: "credit.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/credit/companies/:id",
    async ({ params: { id }, drizzle, set }) => {
      const [company] = await drizzle.select().from(credit_companies).where(eq(credit_companies.id, id)).execute();
      if (!company) {
        set.status = 404;
        return { error: "not_found" };
      }
      const [account] = await drizzle.select().from(credit_accounts).where(eq(credit_accounts.company_id, id)).execute();
      const phones = await drizzle.select().from(credit_company_phones).where(eq(credit_company_phones.company_id, id)).execute();
      return { company, account: account ?? { posted: 0, reserved: 0 }, phones };
    },
    {
      permission: "credit.list",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  .post(
    "/credit/companies",
    async ({ body: { data }, drizzle, redis, user }) => createCompany(drizzle, redis, data, user!.id),
    {
      permission: "credit.edit",
      body: t.Object({
        data: t.Object({
          name: t.String({ minLength: 2 }),
          inn: t.Optional(t.String()),
          phone: t.Optional(t.String()),
          status: t.Union([t.Literal("active"), t.Literal("suspended"), t.Literal("pending_verification")]),
          limit_total: t.Integer({ minimum: 0 }),
          limit_daily: t.Integer({ minimum: 0 }),
          limit_monthly: t.Integer({ minimum: 0 }),
        }),
      }),
    }
  )
  .put(
    "/credit/companies/:id",
    async ({ params: { id }, body: { data }, drizzle, redis, user }) => updateCompany(drizzle, redis, id, data, user!.id),
    {
      permission: "credit.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        data: t.Object({
          name: t.Optional(t.String({ minLength: 2 })),
          inn: t.Optional(t.String()),
          phone: t.Optional(t.String()),
          status: t.Optional(t.Union([t.Literal("active"), t.Literal("suspended"), t.Literal("pending_verification")])),
          limit_total: t.Optional(t.Integer({ minimum: 0 })),
          limit_daily: t.Optional(t.Integer({ minimum: 0 })),
          limit_monthly: t.Optional(t.Integer({ minimum: 0 })),
          verified: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .post(
    "/credit/companies/:id/phones",
    async ({ params: { id }, body: { data }, drizzle, redis, set }) => {
      const r = await addPhone(drizzle, redis, id, data);
      if (r && "error" in r) set.status = 400;
      return r;
    },
    {
      permission: "credit.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ data: t.Object({ phone: t.String(), employee_name: t.Optional(t.String()) }) }),
    }
  )
  .put(
    "/credit/phones/:id",
    async ({ params: { id }, body: { data }, drizzle, redis, set }) => {
      // employee_name is a plain admin-facing label, not part of routing —
      // updating it alone must not invalidate any cache key. `active` is the
      // only field that gates checkout eligibility, so only it goes through
      // deactivatePhone (which invalidates).
      if (data.employee_name !== undefined) {
        await drizzle.update(credit_company_phones).set({ employee_name: data.employee_name }).where(eq(credit_company_phones.id, id));
      }
      if (data.active !== undefined) {
        const row = await deactivatePhone(drizzle, redis, id, data.active);
        if (!row) {
          set.status = 404;
          return { error: "not_found" };
        }
        return row;
      }
      const [row] = await drizzle.select().from(credit_company_phones).where(eq(credit_company_phones.id, id));
      if (!row) {
        set.status = 404;
        return { error: "not_found" };
      }
      return row;
    },
    {
      permission: "credit.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ data: t.Object({ employee_name: t.Optional(t.String()), active: t.Optional(t.Boolean()) }) }),
    }
  )
  .post(
    "/credit/companies/:id/documents",
    async ({ params: { id }, body, drizzle, set, user }) => {
      const r = await saveDocument(drizzle, id, body.file, {
        type: body.type,
        doc_number: body.doc_number,
        doc_date: body.doc_date,
        uploaded_by: user!.id,
      });
      if ("error" in r) set.status = 400;
      return r;
    },
    {
      permission: "credit.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        // Schema-level cap (first line of defense, rejected as 422 before the
        // body is even fully read) backed by saveDocument's own byte check
        // (second line, in case a caller bypasses the schema).
        file: t.File({ maxSize: "20m" }),
        type: t.Union([
          t.Literal("contract"),
          t.Literal("inn_cert"),
          t.Literal("guarantee_letter"),
          t.Literal("other"),
        ]),
        doc_number: t.Optional(t.String()),
        doc_date: t.Optional(t.String({ format: "date" })),
      }),
    }
  )
  .get(
    "/credit/companies/:id/documents",
    async ({ params: { id }, drizzle }) => {
      // Explicit column list — file_path is an absolute server path and must
      // never reach the client; downloads go through the permission-gated
      // /credit/documents/:id/download route instead.
      const data = await drizzle
        .select({
          id: credit_company_documents.id,
          type: credit_company_documents.type,
          doc_number: credit_company_documents.doc_number,
          doc_date: credit_company_documents.doc_date,
          uploaded_by: credit_company_documents.uploaded_by,
          created_at: credit_company_documents.created_at,
        })
        .from(credit_company_documents)
        .where(eq(credit_company_documents.company_id, id));
      return { data };
    },
    { permission: "credit.list", params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )
  .get(
    "/credit/documents/:id/download",
    async ({ params: { id }, drizzle, set }) => {
      const [doc] = await drizzle.select().from(credit_company_documents).where(eq(credit_company_documents.id, id));
      if (!doc) {
        set.status = 404;
        return { error: "not_found" };
      }
      const f = Bun.file(doc.file_path);
      if (!(await f.exists())) {
        set.status = 410;
        return { error: "file_missing" };
      }
      // doc_number is admin-entered free text — sanitize before it lands in a
      // header value (see sanitizeFilenamePart); fall back to the always-safe
      // UUID id when sanitizing strips it down to nothing.
      const safeNumber = sanitizeFilenamePart(doc.doc_number ?? "") || doc.id;
      set.headers["content-disposition"] = `attachment; filename="${doc.type}-${safeNumber}${extOf(doc.file_path)}"`;
      return f;
    },
    { permission: "credit.list", params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )
  .delete(
    "/credit/documents/:id",
    async ({ params: { id }, drizzle, set }) => {
      const r = await deleteDocument(drizzle, id);
      // deleteDocument's only error case is `{error:"not_found"}` — a bad id
      // is a 404, not a 400 (there's no invalid-input shape it could return).
      if (r && "error" in r) set.status = 404;
      return r;
    },
    { permission: "credit.edit", params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )
  .post(
    "/credit/companies/:id/payments",
    async ({ params: { id }, body: { data }, set, user }) => {
      const r = await payCompany(id, data, user!.id);
      if (!r.ok) set.status = 400;
      return r;
    },
    {
      permission: "credit.pay",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        data: t.Object({
          amount: t.Integer({ minimum: 1 }),
          // REQUIRED (not Optional) at the schema level: doc_number is the
          // idempotency key applyPayment gates its replay-protection on. A
          // null doc_number is only for legacy/manual entries per
          // CONTRACT.md — the admin UI must always send one.
          doc_number: t.String({ minLength: 1 }),
          doc_date: t.Optional(t.String({ format: "date" })),
          note: t.Optional(t.String()),
        }),
      }),
    }
  )
  .get(
    "/credit/companies/:id/payments",
    // credit.list, not credit.pay: this is a read of the same rows already
    // visible through the /statement route, which credit.list holders can see.
    async ({ params: { id }, drizzle }) => listPayments(drizzle, id),
    { permission: "credit.list", params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )
  .post(
    "/credit/companies/:id/adjustments",
    async ({ params: { id }, body: { data }, set, user }) => {
      const r = await adjustCompany(id, data, user!.id);
      if (!r.ok) set.status = 400;
      return r;
    },
    {
      permission: "credit.pay",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        // Sign convention (matches applyAdjustment/applyPayment): positive
        // reduces debt, negative increases it. Zero is schema-legal here
        // (TypeBox has no "non-zero integer" constraint) and rejected as
        // `bad_amount` by the service itself.
        data: t.Object({ amount: t.Integer(), reason: t.String({ minLength: 1 }) }),
      }),
    }
  )
  .get(
    "/credit/companies/:id/statement",
    async ({ params: { id }, query, drizzle, set }) => {
      const r = await getStatement(drizzle, id, query);
      if ("error" in r) set.status = 404;
      return r;
    },
    {
      permission: "credit.list",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        brand: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/credit/companies/:id/statement/export",
    async ({ params: { id }, query, drizzle, set }) => {
      // exportStatementXlsx has no natural place to signal "no such company"
      // (it just runs the entries query, which returns empty either way) —
      // check up front so a bad id 404s instead of downloading an empty file.
      if (!(await companyExists(drizzle, id))) {
        set.status = 404;
        return { error: "not_found" };
      }
      const buf = await exportStatementXlsx(drizzle, id, query);
      set.headers["content-disposition"] = `attachment; filename="statement-${id}.xlsx"`;
      set.headers["content-type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return buf;
    },
    {
      permission: "credit.list",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        brand: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/credit/summary",
    async ({ drizzle }) => getCreditSummary(drizzle),
    { permission: "credit.list" }
  );

// Widened export: keeps the app root .use() chain from overflowing TS
// instantiation depth (see comment above creditAdminControllerImpl). The
// admin frontend can't get Eden typing off this and instead goes through
// admin/lib/credit-api.ts's hand-typed wrapper.
export const creditAdminController = creditAdminControllerImpl as unknown as Elysia;
