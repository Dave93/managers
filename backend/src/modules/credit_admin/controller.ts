import { credit_accounts, credit_companies, credit_company_phones } from "backend/drizzle/schema";
import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { getCreditDb } from "../credit/db";
import { canonPhone, ensureAccount, invalidateCreditCompanyCache } from "../credit/service";
import { and, desc, eq, SQLWrapper, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";

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
  const patch: any = { ...input, updated_at: new Date() };
  if (input.phone) patch.phone = canonPhone(input.phone);
  if (input.verified === true) {
    patch.verified_by = userId;
    patch.verified_at = new Date();
  }
  delete patch.verified;
  const [row] = await db.update(credit_companies).set(patch).where(eq(credit_companies.id, id)).returning();

  // Invalidate every phone the change could affect: every row in
  // credit_company_phones for this company, plus credit_companies.phone itself
  // (a separate, single "primary contact" field) — a status/limit change can
  // gate checkout for any of them.
  const phones = await db
    .select({ phone: credit_company_phones.phone })
    .from(credit_company_phones)
    .where(eq(credit_company_phones.company_id, id));
  const allPhones = phones.map((p: any) => p.phone).concat(row.phone ? [row.phone] : []);
  if (allPhones.length) await invalidateCreditCompanyCache(redis, allPhones);

  return row;
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
  );
