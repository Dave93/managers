import { ctx } from "@backend/context";
import {
  employees,
  passport_enrollments,
  passport_invites,
  passport_modules,
  passport_program_modules,
  passport_programs,
  passport_topics,
} from "backend/drizzle/schema";
import { validateModuleForPublish } from "./publish-validation";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import Elysia, { t } from "elysia";

// The curriculum is authored per department (chef owns kitchen modules, finance
// owns cash modules, ...), while HR owns the whole thing. "Curriculum admin"
// therefore means: the admin role, an explicit super-user, or anyone holding
// passport.curriculum.publish (HR). Everyone else is confined to the modules of
// their own users.department.
async function isCurriculumAdmin(
  cacheController: {
    getPermissionsByRoleId: (roleId: string) => Promise<string[]>;
  },
  user: { is_super_user?: boolean | null } | null,
  role: { id: string; code: string } | null
): Promise<boolean> {
  if (user?.is_super_user === true) return true;
  if (!role) return false;
  if (role.code === "admin") return true;
  const perms = await cacheController.getPermissionsByRoleId(role.id);
  return perms.includes("passport.curriculum.publish");
}

// Read-side scope check: a published module is still readable by its owners,
// so this one has no 409 branch. Returns the module, or null after setting the
// response status.
async function loadModuleScoped(
  drizzle: any,
  moduleId: string,
  user: any,
  isAdmin: boolean,
  set: any
) {
  const [mod] = await drizzle
    .select()
    .from(passport_modules)
    .where(eq(passport_modules.id, moduleId))
    .execute();
  if (!mod) {
    set.status = 404;
    return null;
  }
  if (!isAdmin && mod.owner_department !== user?.department) {
    set.status = 403;
    return null;
  }
  return mod;
}

// Write-side scope check. A published module is frozen: the only way forward is
// POST /passport/modules/:id/new-version, which forks it into a fresh draft.
async function assertModuleEditable(
  drizzle: any,
  moduleId: string,
  user: any,
  isAdmin: boolean,
  set: any
) {
  const [mod] = await drizzle
    .select()
    .from(passport_modules)
    .where(eq(passport_modules.id, moduleId))
    .execute();
  if (!mod) {
    set.status = 404;
    return null;
  }
  if (mod.status === "published") {
    set.status = 409;
    return null;
  }
  if (!isAdmin && mod.owner_department !== user?.department) {
    set.status = 403;
    return null;
  }
  return mod;
}

// An invite is a printable QR that a trainee scans once. A week is long enough
// for a new hire who starts on Monday and gets their phone sorted out on
// Friday, short enough that a QR left on a noticeboard stops working.
const INVITE_TTL_MS = 7 * 86400_000;

// Thrown inside /reinvite's transaction so that a refusal rolls back rather
// than committing a half-done rotation.
class EnrollmentNotOpenError extends Error {
  constructor(public enrollmentStatus: string) {
    super(`enrollment not open: ${enrollmentStatus}`);
  }
}

// Enrollment read/write scope: HQ sees every branch, everyone else only the
// terminals resolved onto their session. Returns the enrollment, or null after
// setting the response status.
async function loadEnrollmentScoped(
  drizzle: any,
  enrollmentId: string,
  isHQ: boolean,
  terminals: string[],
  set: any
) {
  const [row] = await drizzle
    .select()
    .from(passport_enrollments)
    .where(eq(passport_enrollments.id, enrollmentId))
    .execute();
  if (!row) {
    set.status = 404;
    return null;
  }
  if (!isHQ && !terminals.includes(row.terminal_id)) {
    set.status = 403;
    return null;
  }
  return row;
}

// Widened export (see creditAdminController / iikoSyncController for the same
// pattern): apiController's .use() chain sits at TypeScript's instantiation-depth
// limit, and registering this controller with its fully-inferred type overflows
// it (TS2589 in src/app.ts + src/controllers.ts). The routes are real live HTTP
// endpoints under /api/passport/* (registered on the app root in src/app.ts,
// with an explicit /api prefix since it no longer inherits apiController's);
// only Eden's type inference for them is lost, so the admin UI hand-types
// them the way admin/lib/credit-api.ts does.
const passportControllerImpl = new Elysia({
  name: "@api/passport",
  prefix: "/api",
})
  .use(ctx)
  // ---- programs (HR-owned) ----
  .get(
    "/passport/programs",
    async ({ drizzle }) => {
      const data = await drizzle
        .select()
        .from(passport_programs)
        .orderBy(asc(passport_programs.position))
        .execute();
      return { total: data.length, data };
    },
    { permission: "passport.matrix.view" }
  )
  .post(
    "/passport/programs",
    async ({ drizzle, body }) => {
      const [row] = await drizzle
        .insert(passport_programs)
        .values({
          position: body.position,
          title_ru: body.title_ru,
          title_uz: body.title_uz,
          active: body.active ?? true,
        })
        .returning()
        .execute();
      return row;
    },
    {
      permission: "passport.curriculum.publish",
      body: t.Object({
        position: t.String(),
        title_ru: t.String(),
        title_uz: t.String(),
        active: t.Optional(t.Boolean()),
      }),
    }
  )
  .put(
    "/passport/programs/:id",
    async ({ drizzle, params, body, set }) => {
      const [updated] = await drizzle
        .update(passport_programs)
        .set({ ...body, updated_at: new Date().toISOString() })
        .where(eq(passport_programs.id, params.id))
        .returning()
        .execute();
      if (!updated) {
        set.status = 404;
        return { message: "Program not found" };
      }
      return updated;
    },
    {
      permission: "passport.curriculum.publish",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        position: t.Optional(t.String()),
        title_ru: t.Optional(t.String()),
        title_uz: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
      }),
    }
  )
  // ---- modules ----
  .get(
    "/passport/modules",
    async ({ drizzle, cacheController, user, role, query }) => {
      const conds = [] as any[];
      if (query.program_id) {
        const links = await drizzle
          .select({ module_id: passport_program_modules.module_id })
          .from(passport_program_modules)
          .where(eq(passport_program_modules.program_id, query.program_id))
          .execute();
        // No links at all -> no modules. Never hand inArray an empty list.
        if (!links.length) return { total: 0, data: [] };
        conds.push(
          inArray(
            passport_modules.id,
            links.map((l: { module_id: string }) => l.module_id)
          )
        );
      }
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      if (!isAdmin) {
        // Fail closed: an editor with no department sees nothing, rather than
        // the whole curriculum.
        if (!user?.department) return { total: 0, data: [] };
        conds.push(eq(passport_modules.owner_department, user.department));
      }
      const data = await drizzle
        .select()
        .from(passport_modules)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(passport_modules.title_ru))
        .execute();
      return { total: data.length, data };
    },
    {
      permission: "passport.curriculum.edit",
      query: t.Object({ program_id: t.Optional(t.String({ format: "uuid" })) }),
    }
  )
  .post(
    "/passport/modules",
    async ({ drizzle, cacheController, user, role, body, set }) => {
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const dept = body.owner_department ?? user?.department;
      if (!dept) {
        set.status = 422;
        return { message: "owner_department required" };
      }
      if (!isAdmin && dept !== user?.department) {
        set.status = 403;
        return { message: "Foreign department" };
      }
      const [row] = await drizzle
        .insert(passport_modules)
        .values({
          title_ru: body.title_ru,
          title_uz: body.title_uz ?? "",
          brand: body.brand ?? null,
          owner_department: dept,
          exam_test_id: body.exam_test_id ?? null,
        })
        .returning()
        .execute();
      return row;
    },
    {
      permission: "passport.curriculum.edit",
      body: t.Object({
        title_ru: t.String(),
        title_uz: t.Optional(t.String()),
        brand: t.Optional(t.Nullable(t.String())),
        owner_department: t.Optional(t.String()),
        exam_test_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
      }),
    }
  )
  .put(
    "/passport/modules/:id",
    async ({ drizzle, cacheController, user, role, params, body, set }) => {
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const mod = await assertModuleEditable(
        drizzle,
        params.id,
        user,
        isAdmin,
        set
      );
      if (!mod) return { message: "Module is not editable" };
      // Only HR may hand a module to another department.
      if (
        body.owner_department &&
        !isAdmin &&
        body.owner_department !== user?.department
      ) {
        set.status = 403;
        return { message: "Foreign department" };
      }
      if (!Object.keys(body).length) return mod;
      const [updated] = await drizzle
        .update(passport_modules)
        .set({ ...body, updated_at: new Date().toISOString() })
        .where(eq(passport_modules.id, params.id))
        .returning()
        .execute();
      return updated;
    },
    {
      permission: "passport.curriculum.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        title_ru: t.Optional(t.String()),
        title_uz: t.Optional(t.String()),
        brand: t.Optional(t.Nullable(t.String())),
        owner_department: t.Optional(t.String()),
        exam_test_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
      }),
    }
  )
  .post(
    "/passport/modules/:id/submit-review",
    async ({ drizzle, cacheController, user, role, params, set }) => {
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const mod = await assertModuleEditable(
        drizzle,
        params.id,
        user,
        isAdmin,
        set
      );
      if (!mod) return { message: "Module is not editable" };
      if (mod.status !== "draft") {
        set.status = 409;
        return { message: "Only a draft can be sent to review" };
      }
      const [updated] = await drizzle
        .update(passport_modules)
        .set({ status: "review", updated_at: new Date().toISOString() })
        .where(eq(passport_modules.id, params.id))
        .returning()
        .execute();
      return updated;
    },
    {
      permission: "passport.curriculum.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  .post(
    "/passport/modules/:id/publish",
    async ({ drizzle, params, set }) => {
      const [mod] = await drizzle
        .select()
        .from(passport_modules)
        .where(eq(passport_modules.id, params.id))
        .execute();
      if (!mod) {
        set.status = 404;
        return { message: "Module not found" };
      }
      if (mod.status === "published") {
        set.status = 409;
        return { message: "Module is already published" };
      }
      const topics = await drizzle
        .select()
        .from(passport_topics)
        .where(
          and(
            eq(passport_topics.module_id, params.id),
            eq(passport_topics.active, true)
          )
        )
        .orderBy(asc(passport_topics.sort))
        .execute();
      const errors = validateModuleForPublish(mod as any, topics as any);
      if (errors.length) {
        set.status = 422;
        return { errors };
      }
      const [updated] = await drizzle
        .update(passport_modules)
        .set({ status: "published", updated_at: new Date().toISOString() })
        .where(eq(passport_modules.id, params.id))
        .returning()
        .execute();
      return updated;
    },
    {
      permission: "passport.curriculum.publish",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  // A published module is frozen; changing it means forking a new draft version.
  .post(
    "/passport/modules/:id/new-version",
    async ({ drizzle, cacheController, user, role, params, set }) => {
      const [mod] = await drizzle
        .select()
        .from(passport_modules)
        .where(eq(passport_modules.id, params.id))
        .execute();
      if (!mod) {
        set.status = 404;
        return { message: "Module not found" };
      }
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      if (!isAdmin && mod.owner_department !== user?.department) {
        set.status = 403;
        return { message: "Foreign department" };
      }
      if (mod.status !== "published") {
        set.status = 409;
        return { message: "Only a published module can be forked" };
      }
      const { id, created_at, updated_at, parent_module_id, ...rest } =
        mod as any;
      // Lineage points at the ROOT of the version chain, never at the immediate
      // parent: an enrollment is pinned to one curriculum version, and asking
      // "which module family is this trainee on" must be one comparison, not a
      // walk up a linked list.
      const rootId = mod.parent_module_id ?? mod.id;
      // All-or-nothing: the fork is not idempotent, so a half-copied draft left
      // behind by a mid-loop failure could never be repaired by a retry — the
      // retry would just create a second partial fork.
      const copy = await drizzle.transaction(async (tx) => {
        const [created] = await tx
          .insert(passport_modules)
          .values({
            ...rest,
            status: "draft",
            version: mod.version + 1,
            parent_module_id: rootId,
          })
          .returning()
          .execute();
        const topics = await tx
          .select()
          .from(passport_topics)
          .where(eq(passport_topics.module_id, params.id))
          .orderBy(asc(passport_topics.sort))
          .execute();
        for (const tp of topics) {
          const { id: _topicId, ...trest } = tp as any;
          await tx
            .insert(passport_topics)
            .values({ ...trest, module_id: created.id })
            .execute();
        }
        return created;
      });
      return copy;
    },
    {
      permission: "passport.curriculum.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  // ---- topics ----
  .get(
    "/passport/modules/:id/topics",
    async ({ drizzle, cacheController, user, role, params, set }) => {
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const mod = await loadModuleScoped(drizzle, params.id, user, isAdmin, set);
      if (!mod) return { message: "Module is not accessible" };
      const data = await drizzle
        .select()
        .from(passport_topics)
        .where(eq(passport_topics.module_id, params.id))
        .orderBy(asc(passport_topics.sort))
        .execute();
      return { total: data.length, data };
    },
    {
      permission: "passport.curriculum.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  .post(
    "/passport/topics",
    async ({ drizzle, cacheController, user, role, body, set }) => {
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const mod = await assertModuleEditable(
        drizzle,
        body.module_id,
        user,
        isAdmin,
        set
      );
      if (!mod) return { message: "Module is not editable" };
      const [row] = await drizzle
        .insert(passport_topics)
        .values({
          module_id: body.module_id,
          sort: body.sort ?? 0,
          title_ru: body.title_ru,
          title_uz: body.title_uz ?? "",
          step_ru: body.step_ru ?? "",
          step_uz: body.step_uz ?? "",
          key_point_ru: body.key_point_ru ?? "",
          key_point_uz: body.key_point_uz ?? "",
          reason_ru: body.reason_ru ?? "",
          reason_uz: body.reason_uz ?? "",
          video_id: body.video_id ?? null,
          verification_type: body.verification_type ?? "quiz_observation",
          quiz_test_id: body.quiz_test_id ?? null,
          observation_checklist: body.observation_checklist ?? null,
          active: body.active ?? true,
        })
        .returning()
        .execute();
      return row;
    },
    {
      permission: "passport.curriculum.edit",
      body: t.Object({
        module_id: t.String({ format: "uuid" }),
        sort: t.Optional(t.Number()),
        title_ru: t.String(),
        title_uz: t.Optional(t.String()),
        step_ru: t.Optional(t.String()),
        step_uz: t.Optional(t.String()),
        key_point_ru: t.Optional(t.String()),
        key_point_uz: t.Optional(t.String()),
        reason_ru: t.Optional(t.String()),
        reason_uz: t.Optional(t.String()),
        video_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        verification_type: t.Optional(
          t.Union([
            t.Literal("quiz"),
            t.Literal("observation"),
            t.Literal("quiz_observation"),
            t.Literal("quiz_observation_photo"),
            t.Literal("dual"),
          ])
        ),
        quiz_test_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        observation_checklist: t.Optional(t.Any()),
        active: t.Optional(t.Boolean()),
      }),
    }
  )
  .put(
    "/passport/topics/:id",
    async ({ drizzle, cacheController, user, role, params, body, set }) => {
      const [topic] = await drizzle
        .select()
        .from(passport_topics)
        .where(eq(passport_topics.id, params.id))
        .execute();
      if (!topic) {
        set.status = 404;
        return { message: "Topic not found" };
      }
      const isAdmin = await isCurriculumAdmin(cacheController, user, role);
      const mod = await assertModuleEditable(
        drizzle,
        topic.module_id,
        user,
        isAdmin,
        set
      );
      if (!mod) return { message: "Module is not editable" };
      if (!Object.keys(body).length) return topic;
      const [updated] = await drizzle
        .update(passport_topics)
        .set({ ...body })
        .where(eq(passport_topics.id, params.id))
        .returning()
        .execute();
      return updated;
    },
    {
      permission: "passport.curriculum.edit",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        sort: t.Optional(t.Number()),
        title_ru: t.Optional(t.String()),
        title_uz: t.Optional(t.String()),
        step_ru: t.Optional(t.String()),
        step_uz: t.Optional(t.String()),
        key_point_ru: t.Optional(t.String()),
        key_point_uz: t.Optional(t.String()),
        reason_ru: t.Optional(t.String()),
        reason_uz: t.Optional(t.String()),
        video_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        verification_type: t.Optional(
          t.Union([
            t.Literal("quiz"),
            t.Literal("observation"),
            t.Literal("quiz_observation"),
            t.Literal("quiz_observation_photo"),
            t.Literal("dual"),
          ])
        ),
        quiz_test_id: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        observation_checklist: t.Optional(t.Any()),
        active: t.Optional(t.Boolean()),
      }),
    }
  )
  // ---- program <-> module links (HR only) ----
  .post(
    "/passport/program-modules",
    async ({ drizzle, body, set }) => {
      const [program] = await drizzle
        .select({ id: passport_programs.id })
        .from(passport_programs)
        .where(eq(passport_programs.id, body.program_id))
        .execute();
      if (!program) {
        set.status = 404;
        return { message: "Program not found" };
      }
      const [mod] = await drizzle
        .select({ id: passport_modules.id })
        .from(passport_modules)
        .where(eq(passport_modules.id, body.module_id))
        .execute();
      if (!mod) {
        set.status = 404;
        return { message: "Module not found" };
      }
      const values = {
        program_id: body.program_id,
        module_id: body.module_id,
        sort: body.sort ?? 0,
        required: body.required ?? true,
        deadline_days: body.deadline_days ?? null,
      };
      const [row] = await drizzle
        .insert(passport_program_modules)
        .values(values)
        .onConflictDoUpdate({
          target: [
            passport_program_modules.program_id,
            passport_program_modules.module_id,
          ],
          set: {
            sort: values.sort,
            required: values.required,
            deadline_days: values.deadline_days,
          },
        })
        .returning()
        .execute();
      return row;
    },
    {
      permission: "passport.curriculum.publish",
      body: t.Object({
        program_id: t.String({ format: "uuid" }),
        module_id: t.String({ format: "uuid" }),
        sort: t.Optional(t.Number()),
        required: t.Optional(t.Boolean()),
        deadline_days: t.Optional(t.Nullable(t.Number())),
      }),
    }
  )
  // ---- enrollments (HR starts a trainee's training, trainee gets a QR) ----
  .post(
    "/passport/enrollments",
    async ({ drizzle, cacheController, user, role, terminals, body, set }) => {
      const [emp] = await drizzle
        .select()
        .from(employees)
        .where(eq(employees.id, body.employee_id))
        .execute();
      if (!emp) {
        set.status = 404;
        return { message: "Employee not found" };
      }
      const isHQ = await resolveIsHq({ user, role, cacheController });
      // terminal_id is taken from the employee, never from the request body:
      // it is the column the whole read side scopes on, so a caller-supplied
      // value would let a branch HR park a trainee in someone else's branch
      // (or hide one from their own).
      if (!isHQ && !terminals.includes(emp.terminal_id)) {
        set.status = 403;
        return { message: "Out of scope" };
      }
      const [program] = await drizzle
        .select({ id: passport_programs.id })
        .from(passport_programs)
        .where(eq(passport_programs.id, body.program_id))
        .execute();
      if (!program) {
        set.status = 404;
        return { message: "Program not found" };
      }
      const startedAt = new Date();
      const created = await drizzle.transaction(async (tx) => {
        // Serialize concurrent enrollments of the SAME employee. There is no
        // unique index to lean on (an employee legitimately accumulates many
        // closed enrollments over time) and the open-enrollment check below is
        // a read, so two simultaneous POSTs would both see "none" and both
        // insert. The advisory lock is held to end of transaction and only
        // collides with another enrollment of the same employee.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${body.employee_id}))`
        );
        // One trainee = one live passport. Topic progress is unique per
        // (enrollment_id, topic_id) and the trainee's telegram binding is per
        // EMPLOYEE, so a second open enrollment would split one person's
        // progress across two records that nothing can merge, and the miniapp
        // could not tell which one is "the" passport. HR gets a 409 naming the
        // existing enrollment; the intended moves are /reinvite or /close.
        const [open] = await tx
          .select()
          .from(passport_enrollments)
          .where(
            and(
              eq(passport_enrollments.employee_id, body.employee_id),
              inArray(passport_enrollments.status, ["active", "paused"])
            )
          )
          .execute();
        if (open) return { conflict: open, enrollment: null, invite: null };
        const [enrollment] = await tx
          .insert(passport_enrollments)
          .values({
            employee_id: emp.id,
            program_id: body.program_id,
            terminal_id: emp.terminal_id,
            // started_at is passed explicitly rather than left to defaultNow()
            // so that probation_deadline is provably started_at + N days.
            started_at: startedAt.toISOString(),
            probation_deadline: new Date(
              startedAt.getTime() + body.probation_days * 86400_000
            ).toISOString(),
            created_by_user_id: user!.id,
          })
          .returning()
          .execute();
        // Same transaction as the enrollment: an enrollment with no invite is
        // a trainee who cannot open their passport, and nothing repairs that
        // automatically — it needs a human to notice and call /reinvite.
        const [invite] = await tx
          .insert(passport_invites)
          .values({
            enrollment_id: enrollment.id,
            created_by_user_id: user!.id,
            expires_at: new Date(
              startedAt.getTime() + INVITE_TTL_MS
            ).toISOString(),
          })
          .returning()
          .execute();
        return { conflict: null, enrollment, invite };
      });
      if (created.conflict) {
        set.status = 409;
        // The scope check above validated the employee's CURRENT terminal; the
        // conflicting enrollment carries the terminal snapshotted when it was
        // created, and for a transferred employee those differ. Naming that
        // enrollment would disclose a record from a branch this caller cannot
        // see — and would dead-end them, since /close and /reinvite on it both
        // 403. In-scope conflicts keep the actionable body.
        if (!isHQ && !terminals.includes(created.conflict.terminal_id)) {
          return {
            message:
              "Employee already has an open enrollment at another branch — contact HQ",
          };
        }
        return {
          message: "Employee already has an open enrollment",
          enrollment_id: created.conflict.id,
          program_id: created.conflict.program_id,
          status: created.conflict.status,
        };
      }
      // invite_id is the QR payload:
      // https://t.me/<PASSPORT_BOT>?startapp=inv_<invite_id>
      return {
        enrollment: created.enrollment,
        invite_id: created.invite!.id,
        invite_expires_at: created.invite!.expires_at,
      };
    },
    {
      permission: "passport.enrollments.manage",
      body: t.Object({
        employee_id: t.String({ format: "uuid" }),
        program_id: t.String({ format: "uuid" }),
        probation_days: t.Number({ minimum: 1, maximum: 365 }),
      }),
    }
  )
  .get(
    "/passport/enrollments",
    async ({ drizzle, cacheController, user, role, terminals, query }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) {
        // Fail closed. The reports controller only narrows when the scope is
        // non-empty, i.e. an unscoped non-HQ user there sees the whole company;
        // for trainee records that default is wrong, and inArray must never be
        // handed an empty list either.
        if (!terminals.length) return { total: 0, data: [] };
        where.push(inArray(passport_enrollments.terminal_id, terminals));
      }
      if (query.terminal_id)
        where.push(eq(passport_enrollments.terminal_id, query.terminal_id));
      if (query.status)
        where.push(eq(passport_enrollments.status, query.status));
      if (query.employee_id)
        where.push(eq(passport_enrollments.employee_id, query.employee_id));
      if (query.program_id)
        where.push(eq(passport_enrollments.program_id, query.program_id));
      const whereClause = where.length ? and(...where) : undefined;
      const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
      // Counted on the base table with the same predicate — the joins below are
      // display-only and must not be able to change the total.
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(passport_enrollments)
        .where(whereClause)
        .execute();
      const data = await drizzle
        .select({
          id: passport_enrollments.id,
          employee_id: passport_enrollments.employee_id,
          program_id: passport_enrollments.program_id,
          terminal_id: passport_enrollments.terminal_id,
          status: passport_enrollments.status,
          started_at: passport_enrollments.started_at,
          probation_deadline: passport_enrollments.probation_deadline,
          completed_at: passport_enrollments.completed_at,
          created_at: passport_enrollments.created_at,
          first_name: employees.first_name,
          last_name: employees.last_name,
          position: employees.position,
          program_title_ru: passport_programs.title_ru,
          program_title_uz: passport_programs.title_uz,
        })
        .from(passport_enrollments)
        .leftJoin(employees, eq(employees.id, passport_enrollments.employee_id))
        .leftJoin(
          passport_programs,
          eq(passport_programs.id, passport_enrollments.program_id)
        )
        .where(whereClause)
        .orderBy(desc(passport_enrollments.created_at))
        .limit(limit)
        .offset(offset)
        .execute();
      // Number(): count(*) comes back from pg as a bigint STRING, and the
      // empty-scope early return above yields a numeric 0 — the same endpoint
      // must not answer "2" on one call and 0 on the next.
      return { total: Number(count[0].count), data };
    },
    {
      permission: "passport.matrix.view",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("active"),
            t.Literal("completed"),
            t.Literal("failed"),
            t.Literal("paused"),
          ])
        ),
        terminal_id: t.Optional(t.String({ format: "uuid" })),
        employee_id: t.Optional(t.String({ format: "uuid" })),
        program_id: t.Optional(t.String({ format: "uuid" })),
      }),
    }
  )
  .post(
    "/passport/enrollments/:id/close",
    async ({
      drizzle,
      cacheController,
      user,
      role,
      terminals,
      params,
      body,
      set,
    }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const enr = await loadEnrollmentScoped(
        drizzle,
        params.id,
        isHQ,
        terminals,
        set
      );
      if (!enr) return { message: "Enrollment is not accessible" };
      if (enr.status === "completed" || enr.status === "failed") {
        set.status = 409;
        return { message: "Enrollment is already closed", status: enr.status };
      }
      const closed = await drizzle.transaction(async (tx) => {
        // The status predicate repeats in the UPDATE so that two concurrent
        // closes cannot both report success with different results.
        const [updated] = await tx
          .update(passport_enrollments)
          .set({ status: body.result, completed_at: sql`now()` })
          .where(
            and(
              eq(passport_enrollments.id, params.id),
              inArray(passport_enrollments.status, ["active", "paused"])
            )
          )
          .returning()
          .execute();
        if (!updated) return null;
        // A closed passport must stop handing out sessions: a QR printed
        // before the close would otherwise still bind a telegram account to a
        // finished (or failed) enrollment. Revoked the same way /reinvite does.
        await tx
          .update(passport_invites)
          .set({ expires_at: sql`now() - interval '1 minute'` })
          .where(
            and(
              eq(passport_invites.enrollment_id, params.id),
              isNull(passport_invites.used_at),
              sql`${passport_invites.expires_at} > now()`
            )
          )
          .execute();
        return updated;
      });
      if (!closed) {
        set.status = 409;
        return { message: "Enrollment is already closed" };
      }
      return closed;
    },
    {
      permission: "passport.enrollments.manage",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        result: t.Union([t.Literal("completed"), t.Literal("failed")]),
      }),
    }
  )
  .post(
    "/passport/enrollments/:id/reinvite",
    async ({ drizzle, cacheController, user, role, terminals, params, set }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const enr = await loadEnrollmentScoped(
        drizzle,
        params.id,
        isHQ,
        terminals,
        set
      );
      if (!enr) return { message: "Enrollment is not accessible" };
      if (enr.status === "completed" || enr.status === "failed") {
        set.status = 409;
        return { message: "Enrollment is closed", status: enr.status };
      }
      let issued;
      try {
        issued = await drizzle.transaction(async (tx) => {
          // Re-read the status INSIDE the transaction, holding the enrollment row
          // (`for update`). The check above ran on the outer handle, so a /close
          // committing in between would leave this transaction revoking nothing
          // (those invites are already backdated) and then inserting a live 7-day
          // invite against a completed/failed enrollment — and the tg redeem has
          // no enrollment-status predicate, so that QR would still bind an
          // account to a finished passport. /close repeats its status predicate
          // inside its own UPDATE for the same reason; this is the other half of
          // that pair. The row lock also orders the two: whichever commits first,
          // the other sees the committed status.
          const [cur] = await tx
            .select({ status: passport_enrollments.status })
            .from(passport_enrollments)
            .where(eq(passport_enrollments.id, params.id))
            .for("update")
            .execute();
          // Throwing rolls the transaction back, so a refusal cannot leave the
          // old invites revoked with no replacement.
          if (!cur) throw new EnrollmentNotOpenError("missing");
          if (cur.status === "completed" || cur.status === "failed")
            throw new EnrollmentNotOpenError(cur.status);
          // Revoke by BACKDATING expires_at, and leave used_at alone: used_at is
          // the tg side's "already redeemed, re-entry is fine" signal, so burning
          // it here would make a never-scanned QR indistinguishable from a
          // redeemed one. Backdating (rather than expires_at = now()) closes a
          // read-committed race: a redeem that blocked on this row lock
          // re-evaluates `expires_at > now()` with ITS OWN transaction timestamp,
          // which can precede ours.
          const revoked = await tx
            .update(passport_invites)
            .set({ expires_at: sql`now() - interval '1 minute'` })
            .where(
              and(
                eq(passport_invites.enrollment_id, params.id),
                isNull(passport_invites.used_at),
                sql`${passport_invites.expires_at} > now()`
              )
            )
            .returning({ id: passport_invites.id })
            .execute();
          const [invite] = await tx
            .insert(passport_invites)
            .values({
              enrollment_id: params.id,
              created_by_user_id: user!.id,
              expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
            })
            .returning()
            .execute();
          return { revoked: revoked.length, invite };
        });
      } catch (e) {
        if (e instanceof EnrollmentNotOpenError) {
          set.status = e.enrollmentStatus === "missing" ? 404 : 409;
          return e.enrollmentStatus === "missing"
            ? { message: "Enrollment not found" }
            : { message: "Enrollment is closed", status: e.enrollmentStatus };
        }
        throw e;
      }
      return {
        invite_id: issued.invite.id,
        expires_at: issued.invite.expires_at,
        revoked: issued.revoked,
      };
    },
    {
      permission: "passport.enrollments.manage",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  );

export const passportController = passportControllerImpl as unknown as Elysia;
