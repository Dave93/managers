import { credit_accounts, credit_companies, credit_company_documents, credit_company_phones } from "backend/drizzle/schema";
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { getCreditDb } from "../credit/db";
import { canonPhone, ensureAccount, invalidateCreditCompanyCache } from "../credit/service";
import { and, desc, eq, SQLWrapper, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import fs from "fs";
import { randomUUID } from "crypto";

// db/redis are typed `any` here on purpose: the route passes ctx's node-postgres
// `drizzle` + ioredis `redis`, tests pass a drizzle-orm/postgres-js handle + a
// stub recording `del` calls. Only plain ORM insert/update/select is done with
// `db` here — no raw `.execute()` — so the driver-shape hazard documented in
// modules/credit/db.ts does not apply. `ensureAccount` (a service.ts function)
// always goes through `getCreditDb()`, never the `db` passed in, per CONTRACT.md.
export async function createCompany(db: any, redis: any, input: any, userId: string) {
  const phone = input.phone ? canonPhone(input.phone) : null;
  const [row] = await db.insert(credit_companies).values({ ...input, phone }).returning();
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

  const patch: any = { ...input, updated_at: new Date() };
  if (input.phone) patch.phone = canonPhone(input.phone);
  // verified_by/verified_at stamp once: a second `verified:true` on an already-
  // verified company must not overwrite the original verifier/timestamp — it's
  // an audit trail, not a toggle. No-op (not an error) when already verified.
  if (input.verified === true && !existing?.verified_at) {
    patch.verified_by = userId;
    patch.verified_at = new Date();
  }
  delete patch.verified;
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
  // `uuid` column makes postgres throw "invalid input syntax for type uuid",
  // caught here and folded into the same company_not_found result instead of
  // a raw 500. Route-level t.String({format:"uuid"}) params catch the common
  // case earlier (422); this is the belt-and-braces layer for the helper
  // itself, since anything can call saveDocument directly.
  let company;
  try {
    [company] = await db.select({ id: credit_companies.id }).from(credit_companies).where(eq(credit_companies.id, companyId));
  } catch {
    return { error: "company_not_found" };
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
  try {
    fs.unlinkSync(doc.file_path);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e; // tolerate a file that already vanished out-of-band
  }
  await db.delete(credit_company_documents).where(eq(credit_company_documents.id, id));
  return { ok: true };
}

export const creditAdminController = new Elysia({ name: "@api/credit_admin" })
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
      params: t.Object({ id: t.String() }),
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
      params: t.Object({ id: t.String() }),
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
      if (r && "error" in r) set.status = 400;
      return r;
    },
    { permission: "credit.edit", params: t.Object({ id: t.String({ format: "uuid" }) }) }
  );
