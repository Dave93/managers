import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  attestation_tests,
  attestation_test_questions,
  attestation_test_question_options,
} from "backend/drizzle/schema";
import {
  and,
  asc,
  eq,
  inArray,
  sql,
  SQLWrapper,
  InferSelectModel,
} from "drizzle-orm";
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
  )
  // ---- authoring: questions with options ----
  .get(
    "/attestation/tests/:testId/questions",
    async ({ params: { testId }, drizzle }) => {
      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(eq(attestation_test_questions.test_id, testId))
        .orderBy(asc(attestation_test_questions.sort))
        .execute();
      const qIds = questions.map((q) => q.id);
      const options = qIds.length
        ? await drizzle
            .select()
            .from(attestation_test_question_options)
            .where(inArray(attestation_test_question_options.question_id, qIds))
            .orderBy(asc(attestation_test_question_options.sort))
            .execute()
        : [];
      return {
        data: questions.map((q) => ({
          ...q,
          options: options.filter((o) => o.question_id === q.id),
        })),
      };
    },
    { permission: "tests.edit", params: t.Object({ testId: t.String() }) }
  )
  .post(
    "/attestation/questions",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_test_questions)
        .values(data)
        .returning({ id: attestation_test_questions.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.edit",
      body: t.Object({
        data: t.Object({
          test_id: t.String(),
          text: t.String(),
          type: t.Optional(t.Union([t.Literal("single"), t.Literal("multi")])),
          explanation: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/attestation/questions/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_test_questions)
        .set(data)
        .where(eq(attestation_test_questions.id, id))
        .returning({ id: attestation_test_questions.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          text: t.Optional(t.String()),
          type: t.Optional(t.Union([t.Literal("single"), t.Literal("multi")])),
          explanation: t.Optional(t.Nullable(t.String())),
          sort: t.Optional(t.Number()),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/questions/:id",
    async ({ params: { id }, drizzle }) => {
      await drizzle
        .delete(attestation_test_question_options)
        .where(eq(attestation_test_question_options.question_id, id))
        .execute();
      const deleted = await drizzle
        .delete(attestation_test_questions)
        .where(eq(attestation_test_questions.id, id))
        .returning({ id: attestation_test_questions.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/options",
    async ({ body: { data }, drizzle }) => {
      const inserted = await drizzle
        .insert(attestation_test_question_options)
        .values(data)
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "tests.edit",
      body: t.Object({
        data: t.Object({
          question_id: t.String(),
          text: t.String(),
          is_correct: t.Optional(t.Boolean()),
          sort: t.Optional(t.Number()),
        }),
      }),
    }
  )
  .put(
    "/attestation/options/:id",
    async ({ params: { id }, body: { data }, drizzle }) => {
      const updated = await drizzle
        .update(attestation_test_question_options)
        .set(data)
        .where(eq(attestation_test_question_options.id, id))
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return updated[0];
    },
    {
      permission: "tests.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          text: t.Optional(t.String()),
          is_correct: t.Optional(t.Boolean()),
          sort: t.Optional(t.Number()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/options/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(attestation_test_question_options)
        .where(eq(attestation_test_question_options.id, id))
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
  );
