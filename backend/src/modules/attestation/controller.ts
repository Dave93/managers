import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { attestation_tests } from "backend/drizzle/schema";
import { and, eq, sql, SQLWrapper, InferSelectModel } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

export const attestationController = new Elysia({
  name: "@api/attestation",
})
  .use(ctx)
  // ---- tests ----
  .get(
    "/attestation/tests",
    async ({ query: { limit, offset, filters, fields }, drizzle }) => {
      let selectFields: SelectedFields = {};
      if (fields) selectFields = parseSelectFields(fields, attestation_tests, {});
      let whereClause: (SQLWrapper | undefined)[] = [];
      if (filters) whereClause = parseFilterFields(filters, attestation_tests, {});
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(attestation_tests)
        .where(and(...whereClause))
        .execute();
      const rows = (await drizzle
        .select(selectFields)
        .from(attestation_tests)
        .where(and(...whereClause))
        .limit(+limit)
        .offset(+offset)
        .execute()) as InferSelectModel<typeof attestation_tests>[];
      return { total: count[0].count, data: rows };
    },
    {
      permission: "tests.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        sort: t.Optional(t.String()),
        filters: t.Optional(t.String()),
        fields: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/tests/:id",
    async ({ params: { id }, set, drizzle }) => {
      const row = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, id))
        .execute();
      if (!row.length) {
        set.status = 404;
        return { message: "Test not found" };
      }
      return row[0];
    },
    { permission: "tests.one", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/tests",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_tests)
        .values(data)
        .returning({ id: attestation_tests.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.add",
      body: t.Object({
        data: t.Object({
          title: t.String(),
          description: t.Optional(t.Nullable(t.String())),
          passing_score: t.Optional(t.Number()),
          time_limit_minutes: t.Optional(t.Nullable(t.Number())),
          questions_per_attempt: t.Optional(t.Nullable(t.Number())),
          shuffle_questions: t.Optional(t.Boolean()),
          shuffle_options: t.Optional(t.Boolean()),
          valid_months: t.Optional(t.Nullable(t.Number())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/attestation/tests/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_tests)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(attestation_tests.id, id))
        .returning({ id: attestation_tests.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          title: t.Optional(t.String()),
          description: t.Optional(t.Nullable(t.String())),
          passing_score: t.Optional(t.Number()),
          time_limit_minutes: t.Optional(t.Nullable(t.Number())),
          questions_per_attempt: t.Optional(t.Nullable(t.Number())),
          shuffle_questions: t.Optional(t.Boolean()),
          shuffle_options: t.Optional(t.Boolean()),
          valid_months: t.Optional(t.Nullable(t.Number())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/tests/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(attestation_tests)
        .where(eq(attestation_tests.id, id))
        .returning({ id: attestation_tests.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.delete", params: t.Object({ id: t.String() }) }
  );
