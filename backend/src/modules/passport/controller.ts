import { ctx } from "@backend/context";
import {
  passport_modules,
  passport_program_modules,
  passport_programs,
  passport_topics,
} from "backend/drizzle/schema";
import { validateModuleForPublish } from "./publish-validation";
import { and, asc, eq, inArray } from "drizzle-orm";
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
  );

export const passportController = passportControllerImpl as unknown as Elysia;
