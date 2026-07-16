import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import {
  attestation_tests,
  attestation_test_questions,
  attestation_test_question_options,
  attestation_test_attempts,
  attestation_test_attempt_answers,
  employees,
  users,
  roles_permissions,
  permissions,
} from "backend/drizzle/schema";
import {
  gradeAttempt,
  pickQuestionIds,
  shuffleWithRng,
  type GradableQuestion,
} from "./grading";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  SQLWrapper,
  InferSelectModel,
} from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

// Never leak the PIN hash to any client.
function stripPin<T extends { pin_hash?: unknown }>(row: T): Omit<T, "pin_hash"> {
  const { pin_hash, ...rest } = row;
  return rest;
}

// Manager-PIN brute-force lockout: N failures within the window blocks further
// tries. Keyed by the manager (branch account) id.
const PIN_MAX_FAILS = 5;
const PIN_LOCK_WINDOW_SEC = 15 * 60;
const pinFailKey = (accountId: string) =>
  `${process.env.PROJECT_PREFIX}attestation_pin_fail:${accountId}`;

// Explicit HQ marker — super-user, or the caller's role holds attestation.hq.
// Never inferred from empty terminal scope (that would be fail-open).
async function resolveIsHq(args: {
  user: { is_super_user?: boolean | null } | null;
  role: { id: string } | null;
  cacheController: {
    getPermissionsByRoleId: (roleId: string) => Promise<string[]>;
  };
}): Promise<boolean> {
  if (args.user?.is_super_user === true) return true;
  if (!args.role) return false;
  const perms = await args.cacheController.getPermissionsByRoleId(args.role.id);
  return perms.includes("attestation.hq");
}

// Role ids whose role holds attestation.run — i.e. branch-manager launcher
// accounts. Used by the admin manager-PIN management endpoints.
async function attestationRunRoleIds(drizzle: any): Promise<string[]> {
  const rows = await drizzle
    .select({ role_id: roles_permissions.role_id })
    .from(roles_permissions)
    .innerJoin(permissions, eq(permissions.id, roles_permissions.permission_id))
    .where(eq(permissions.slug, "attestation.run"))
    .execute();
  return [
    ...new Set(rows.map((r: any) => r.role_id).filter(Boolean) as string[]),
  ];
}

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
    "/attestation/tests/:id/questions",
    async ({ params: { id: testId }, drizzle }) => {
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
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
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
    "/attestation/answer_options",
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
    "/attestation/answer_options/:id",
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
    "/attestation/answer_options/:id",
    async ({ params: { id }, drizzle }) => {
      const deleted = await drizzle
        .delete(attestation_test_question_options)
        .where(eq(attestation_test_question_options.id, id))
        .returning({ id: attestation_test_question_options.id })
        .execute();
      return deleted[0];
    },
    { permission: "tests.edit", params: t.Object({ id: t.String() }) }
  )
  // ---- employees roster ----
  .get(
    "/attestation/employees",
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const { limit, offset, search, terminal_id, position, active } = query;
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) where.push(inArray(employees.terminal_id, terminals));
      if (search)
        where.push(
          or(
            ilike(employees.first_name, `%${search}%`),
            ilike(employees.last_name, `%${search}%`)
          )
        );
      if (terminal_id) where.push(eq(employees.terminal_id, terminal_id));
      if (position) where.push(ilike(employees.position, `%${position}%`));
      if (active === "true" || active === "false")
        where.push(eq(employees.active, active === "true"));
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(employees)
        .where(and(...where))
        .execute();
      const rows = await drizzle
        .select()
        .from(employees)
        .where(and(...where))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: count[0].count, data: rows.map(stripPin) };
    },
    {
      permission: "employees.list",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        search: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        position: t.Optional(t.String()),
        active: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/employees/:id",
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const rows = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!rows.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = rows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      return stripPin(emp);
    },
    { permission: "employees.one", params: t.Object({ id: t.String() }) }
  )
  .post(
    "/attestation/employees",
    async ({ body: { data }, user, role, terminals, cacheController, set, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(data.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const inserted = await drizzle
        .insert(employees)
        .values(data)
        .returning({ id: employees.id })
        .execute();
      return { data: inserted[0] };
    },
    {
      permission: "employees.add",
      body: t.Object({
        data: t.Object({
          first_name: t.String(),
          last_name: t.String(),
          position: t.Optional(t.Nullable(t.String())),
          terminal_id: t.String(),
          external_id: t.Optional(t.Nullable(t.String())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .put(
    "/attestation/employees/:id",
    async ({ params: { id }, body: { data }, user, role, terminals, cacheController, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(current[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      if (!isHQ && data.terminal_id != null && data.terminal_id !== current[0].terminal_id) {
        set.status = 403;
        return { message: "Cross-terminal transfer requires HQ" };
      }
      const updated = await drizzle
        .update(employees)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return updated[0];
    },
    {
      permission: "employees.edit",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          first_name: t.Optional(t.String()),
          last_name: t.Optional(t.String()),
          position: t.Optional(t.Nullable(t.String())),
          terminal_id: t.Optional(t.String()),
          external_id: t.Optional(t.Nullable(t.String())),
          active: t.Optional(t.Boolean()),
        }),
      }),
    }
  )
  .delete(
    "/attestation/employees/:id",
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const current = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .execute();
      if (!current.length) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(current[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const deleted = await drizzle
        .delete(employees)
        .where(eq(employees.id, id))
        .returning({ id: employees.id })
        .execute();
      return deleted[0];
    },
    { permission: "employees.delete", params: t.Object({ id: t.String() }) }
  )
  // ---- manager PIN (self-service; the branch account sets its own) ----
  .get(
    "/attestation/manager-pin/status",
    async ({ user, set, drizzle }) => {
      if (!user) {
        set.status = 401;
        return { message: "Unauthorized" };
      }
      const rows = await drizzle
        .select({ pin_hash: users.attestation_pin_hash })
        .from(users)
        .where(eq(users.id, user.id))
        .execute();
      return { has_pin: !!rows[0]?.pin_hash };
    },
    { userAuth: true }
  )
  .post(
    "/attestation/manager-pin",
    async ({ body: { data }, user, set, drizzle }) => {
      if (!user) {
        set.status = 401;
        return { message: "Unauthorized" };
      }
      if (!/^\d{4,6}$/.test(data.pin)) {
        set.status = 400;
        return { message: "PIN must be 4-6 digits" };
      }
      const pin_hash = await Bun.password.hash(data.pin);
      await drizzle
        .update(users)
        .set({ attestation_pin_hash: pin_hash })
        .where(eq(users.id, user.id))
        .execute();
      return { ok: true };
    },
    {
      userAuth: true,
      body: t.Object({ data: t.Object({ pin: t.String() }) }),
    }
  )
  // ---- admin: manage manager PINs (accounts holding attestation.run) ----
  .get(
    "/attestation/manager-pins",
    async ({ query: { limit, offset, search }, drizzle }) => {
      const roleIds = await attestationRunRoleIds(drizzle);
      if (!roleIds.length) return { total: 0, data: [] };
      const where: (SQLWrapper | undefined)[] = [
        inArray(users.role_id, roleIds),
      ];
      if (search)
        where.push(
          or(
            ilike(users.login, `%${search}%`),
            ilike(users.first_name, `%${search}%`),
            ilike(users.last_name, `%${search}%`)
          )
        );
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(and(...where))
        .execute();
      const rows = await drizzle
        .select({
          id: users.id,
          login: users.login,
          first_name: users.first_name,
          last_name: users.last_name,
          has_pin: sql<boolean>`${users.attestation_pin_hash} is not null`,
        })
        .from(users)
        .where(and(...where))
        .limit(+limit)
        .offset(+offset)
        .execute();
      return { total: count[0].count, data: rows };
    },
    {
      permission: "attestation.manage_pins",
      query: t.Object({
        limit: t.String(),
        offset: t.String(),
        search: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/attestation/manager-pins/:userId",
    async ({ params: { userId }, body: { data }, set, drizzle }) => {
      if (!/^\d{4,6}$/.test(data.pin)) {
        set.status = 400;
        return { message: "PIN must be 4-6 digits" };
      }
      const roleIds = await attestationRunRoleIds(drizzle);
      const u = await drizzle
        .select({ id: users.id, role_id: users.role_id })
        .from(users)
        .where(eq(users.id, userId))
        .execute();
      if (!u.length || !u[0].role_id || !roleIds.includes(u[0].role_id)) {
        set.status = 404;
        return { message: "Manager account not found" };
      }
      await drizzle
        .update(users)
        .set({ attestation_pin_hash: await Bun.password.hash(data.pin) })
        .where(eq(users.id, userId))
        .execute();
      return { ok: true };
    },
    {
      permission: "attestation.manage_pins",
      params: t.Object({ userId: t.String() }),
      body: t.Object({ data: t.Object({ pin: t.String() }) }),
    }
  )
  .delete(
    "/attestation/manager-pins/:userId",
    async ({ params: { userId }, set, drizzle }) => {
      const roleIds = await attestationRunRoleIds(drizzle);
      const u = await drizzle
        .select({ id: users.id, role_id: users.role_id })
        .from(users)
        .where(eq(users.id, userId))
        .execute();
      if (!u.length || !u[0].role_id || !roleIds.includes(u[0].role_id)) {
        set.status = 404;
        return { message: "Manager account not found" };
      }
      await drizzle
        .update(users)
        .set({ attestation_pin_hash: null })
        .where(eq(users.id, userId))
        .execute();
      return { ok: true };
    },
    {
      permission: "attestation.manage_pins",
      params: t.Object({ userId: t.String() }),
    }
  )
  // ---- take test: start ----
  .post(
    "/attestation/attempts/start",
    async ({ body: { data }, user, role, terminals, cacheController, set, redis, drizzle }) => {
      const { test_id, employee_id, pin } = data;

      // employee must exist, be active, and be in the manager's scope
      const empRows = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, employee_id))
        .execute();
      if (!empRows.length || !empRows[0].active) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const emp = empRows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }

      // Manager PIN: the branch account (logged-in `user`) authorizes the launch
      // with their own PIN. Fetched fresh from DB (not the cached session user)
      // so a newly-set PIN takes effect without re-login.
      const mgrRows = await drizzle
        .select({ pin_hash: users.attestation_pin_hash })
        .from(users)
        .where(eq(users.id, user!.id))
        .execute();
      const mgrPinHash = mgrRows[0]?.pin_hash;
      if (!mgrPinHash) {
        set.status = 400;
        return { message: "Manager PIN not set" };
      }

      // brute-force lockout keyed by the manager account
      const failKey = pinFailKey(user!.id);
      const fails = parseInt((await redis.get(failKey)) ?? "0");
      if (fails >= PIN_MAX_FAILS) {
        set.status = 429;
        return { message: "Too many failed PIN attempts. Try again later." };
      }

      const pinOk = await Bun.password.verify(pin, mgrPinHash);
      if (!pinOk) {
        const next = await redis.incr(failKey);
        if (next === 1) await redis.expire(failKey, PIN_LOCK_WINDOW_SEC);
        set.status = 401;
        return {
          message: "Invalid PIN",
          remaining_attempts: Math.max(0, PIN_MAX_FAILS - next),
        };
      }
      // success clears the counter
      await redis.del(failKey);

      // reject if a live (in_progress or submitted-not-expired) attempt exists
      const existing = await drizzle
        .select({
          id: attestation_test_attempts.id,
          status: attestation_test_attempts.status,
          passed: attestation_test_attempts.passed,
          expires_at: attestation_test_attempts.expires_at,
        })
        .from(attestation_test_attempts)
        .where(
          and(
            eq(attestation_test_attempts.test_id, test_id),
            eq(attestation_test_attempts.employee_id, employee_id)
          )
        )
        .execute();
      const nowIso = new Date().toISOString();
      const blocking = existing.find(
        (a) =>
          a.status === "in_progress" ||
          (a.status === "submitted" &&
            (a.expires_at == null || a.expires_at > nowIso))
      );
      if (blocking) {
        set.status = 409;
        return {
          message: "An attempt already exists for this test",
          attempt_id: blocking.id,
        };
      }

      // load test + active questions
      const testRows = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, test_id))
        .execute();
      if (!testRows.length || !testRows[0].active) {
        set.status = 404;
        return { message: "Test not found" };
      }
      const test = testRows[0];

      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(
          and(
            eq(attestation_test_questions.test_id, test_id),
            eq(attestation_test_questions.active, true)
          )
        )
        .execute();
      if (!questions.length) {
        set.status = 400;
        return { message: "Test has no questions" };
      }

      // sample + shuffle (non-crypto RNG is fine here; not a secret)
      const rng = Math.random;
      const pickedIds = pickQuestionIds(
        questions.map((q) => q.id),
        test.questions_per_attempt,
        rng
      );
      const orderedIds = test.shuffle_questions
        ? shuffleWithRng(pickedIds, rng)
        : pickedIds;

      const options = await drizzle
        .select()
        .from(attestation_test_question_options)
        .where(inArray(attestation_test_question_options.question_id, orderedIds))
        .execute();

      const created = await drizzle
        .insert(attestation_test_attempts)
        .values({
          test_id,
          employee_id,
          terminal_id: emp.terminal_id, // server-derived, never client-supplied
          launched_by_user_id: user!.id,
          status: "in_progress",
          question_ids: orderedIds,
        })
        .returning({
          id: attestation_test_attempts.id,
          started_at: attestation_test_attempts.started_at,
        })
        .execute();

      const qById = new Map(questions.map((q) => [q.id, q]));
      const sanitizedQuestions = orderedIds.map((qid) => {
        const q = qById.get(qid)!;
        const opts = options
          .filter((o) => o.question_id === qid)
          .map((o) => ({ id: o.id, text: o.text })); // NO is_correct
        return {
          id: q.id,
          text: q.text,
          type: q.type,
          options: test.shuffle_options ? shuffleWithRng(opts, rng) : opts,
        };
      });

      return {
        attempt_id: created[0].id,
        started_at: created[0].started_at,
        time_limit_minutes: test.time_limit_minutes,
        questions: sanitizedQuestions,
      };
    },
    {
      permission: "attestation.run",
      body: t.Object({
        data: t.Object({
          test_id: t.String(),
          employee_id: t.String(),
          pin: t.String(),
        }),
      }),
    }
  )
  // ---- take test: submit ----
  .post(
    "/attestation/attempts/:id/submit",
    async ({ params: { id }, body: { data }, user, role, terminals, cacheController, set, drizzle }) => {
      const attemptRows = await drizzle
        .select()
        .from(attestation_test_attempts)
        .where(eq(attestation_test_attempts.id, id))
        .execute();
      if (!attemptRows.length) {
        set.status = 404;
        return { message: "Attempt not found" };
      }
      const attempt = attemptRows[0];
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(attempt.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      if (attempt.status !== "in_progress") {
        set.status = 409;
        return { message: "Attempt already finalized" };
      }

      const test = (
        await drizzle
          .select()
          .from(attestation_tests)
          .where(eq(attestation_tests.id, attempt.test_id))
          .execute()
      )[0];

      // authoritative server-side timer
      const nowMs = Date.now();
      const startedMs = new Date(attempt.started_at).getTime();
      const overTime =
        test.time_limit_minutes != null &&
        nowMs > startedMs + test.time_limit_minutes * 60_000;

      const questionIds = attempt.question_ids as string[];
      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(inArray(attestation_test_questions.id, questionIds))
        .execute();
      const options = await drizzle
        .select()
        .from(attestation_test_question_options)
        .where(inArray(attestation_test_question_options.question_id, questionIds))
        .execute();

      const gradable: GradableQuestion[] = questions.map((q) => ({
        id: q.id,
        type: q.type as "single" | "multi",
        correctOptionIds: options
          .filter((o) => o.question_id === q.id && o.is_correct)
          .map((o) => o.id),
      }));

      const answerMap: Record<string, string[]> = {};
      for (const a of data.answers) {
        answerMap[a.question_id] = a.selected_option_ids;
      }

      const { score } = gradeAttempt(gradable, answerMap);
      const passed = !overTime && score >= test.passing_score;
      const nowIso = new Date().toISOString();
      const expires_at =
        passed && test.valid_months != null
          ? new Date(
              nowMs + test.valid_months * 30 * 24 * 60 * 60_000
            ).toISOString()
          : null;

      // snapshot answers
      const qTextById = new Map(questions.map((q) => [q.id, q.text]));
      const gradableById = new Map(gradable.map((g) => [g.id, g]));
      const snapshotRows = questionIds.map((qid) => {
        const selected = answerMap[qid] ?? [];
        const g = gradableById.get(qid)!;
        return {
          attempt_id: id,
          question_id: qid,
          question_text: qTextById.get(qid) ?? "",
          selected_option_ids: selected,
          is_correct:
            selected.length > 0 &&
            selected.length === g.correctOptionIds.length &&
            selected.every((s) => g.correctOptionIds.includes(s)),
        };
      });
      if (snapshotRows.length) {
        await drizzle
          .insert(attestation_test_attempt_answers)
          .values(snapshotRows)
          .execute();
      }

      await drizzle
        .update(attestation_test_attempts)
        .set({
          status: overTime ? "expired" : "submitted",
          submitted_at: nowIso,
          score,
          passed,
          expires_at,
        })
        .where(eq(attestation_test_attempts.id, id))
        .execute();

      return { attempt_id: id, score, passed, expired: overTime };
    },
    {
      permission: "attestation.run",
      params: t.Object({ id: t.String() }),
      body: t.Object({
        data: t.Object({
          answers: t.Array(
            t.Object({
              question_id: t.String(),
              selected_option_ids: t.Array(t.String()),
            })
          ),
        }),
      }),
    }
  )
  // ---- HQ retake reset ----
  .post(
    "/attestation/attempts/:id/reset",
    async ({ params: { id }, user, role, terminals, cacheController, set, drizzle }) => {
      const rows = await drizzle
        .select({ terminal_id: attestation_test_attempts.terminal_id })
        .from(attestation_test_attempts)
        .where(eq(attestation_test_attempts.id, id))
        .execute();
      if (!rows.length) {
        set.status = 404;
        return { message: "Attempt not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      if (!isHQ && !terminals.includes(rows[0].terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const updated = await drizzle
        .update(attestation_test_attempts)
        .set({ status: "expired" })
        .where(eq(attestation_test_attempts.id, id))
        .returning({ id: attestation_test_attempts.id })
        .execute();
      return updated[0];
    },
    { permission: "attestation.reset", params: t.Object({ id: t.String() }) }
  )
  // ---- analytics ----
  .get(
    "/attestation/analytics/attempts",
    async ({ query, user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ)
        where.push(inArray(attestation_test_attempts.terminal_id, terminals));
      if (query.terminal_id)
        where.push(eq(attestation_test_attempts.terminal_id, query.terminal_id));
      if (query.test_id)
        where.push(eq(attestation_test_attempts.test_id, query.test_id));
      if (query.passed != null)
        where.push(eq(attestation_test_attempts.passed, query.passed === "true"));
      if (query.search)
        where.push(
          or(
            ilike(employees.first_name, `%${query.search}%`),
            ilike(employees.last_name, `%${query.search}%`)
          )
        );
      const rows = await drizzle
        .select({
          id: attestation_test_attempts.id,
          test_id: attestation_test_attempts.test_id,
          test_title: attestation_tests.title,
          employee_id: attestation_test_attempts.employee_id,
          first_name: employees.first_name,
          last_name: employees.last_name,
          terminal_id: attestation_test_attempts.terminal_id,
          status: attestation_test_attempts.status,
          score: attestation_test_attempts.score,
          passed: attestation_test_attempts.passed,
          submitted_at: attestation_test_attempts.submitted_at,
          expires_at: attestation_test_attempts.expires_at,
        })
        .from(attestation_test_attempts)
        .leftJoin(employees, eq(employees.id, attestation_test_attempts.employee_id))
        .leftJoin(
          attestation_tests,
          eq(attestation_tests.id, attestation_test_attempts.test_id)
        )
        .where(and(...where))
        .limit(+(query.limit ?? "50"))
        .offset(+(query.offset ?? "0"))
        .execute();
      return { data: rows };
    },
    {
      permission: "attestation.analytics",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        terminal_id: t.Optional(t.String()),
        test_id: t.Optional(t.String()),
        passed: t.Optional(t.String()),
        search: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/attestation/analytics/summary",
    async ({ user, role, terminals, cacheController, drizzle }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const scope = isHQ
        ? []
        : [inArray(attestation_test_attempts.terminal_id, terminals)];
      const soonIso = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
      const nowIso = new Date().toISOString();
      const agg = await drizzle
        .select({
          total: sql<number>`count(*)`,
          passed: sql<number>`count(*) filter (where ${attestation_test_attempts.passed} = true)`,
          failed: sql<number>`count(*) filter (where ${attestation_test_attempts.passed} = false)`,
          expiring_soon: sql<number>`count(*) filter (where ${attestation_test_attempts.expires_at} between ${nowIso} and ${soonIso})`,
        })
        .from(attestation_test_attempts)
        .where(and(...scope))
        .execute();
      const a = agg[0];
      const total = Number(a.total);
      return {
        total,
        passed: Number(a.passed),
        failed: Number(a.failed),
        expiring_soon: Number(a.expiring_soon),
        pass_rate: total ? Math.round((Number(a.passed) / total) * 100) : 0,
      };
    },
    { permission: "attestation.analytics" }
  );
