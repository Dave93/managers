import { ctx } from "@backend/context";
import {
  employees,
  organization,
  passport_enrollments,
  passport_invites,
  passport_modules,
  passport_program_modules,
  passport_programs,
  passport_signoffs,
  passport_tg_bindings,
  passport_topic_progress,
  passport_topics,
  // Aliased: every scoped handler in this file destructures a `terminals`
  // string[] out of the session context, and an unaliased import of the table
  // would shadow (or be shadowed by) it depending on the block.
  terminals as terminalsTable,
  users,
} from "backend/drizzle/schema";
import { deadlineStatus } from "./deadline";
import { validateModuleForPublish } from "./publish-validation";
import {
  canObserve,
  hasObservation,
  levelAfterObserved,
  needsPhoto,
  observationComplete,
  type VerificationType,
} from "./state";
import { resolveIsHq } from "@backend/lib/resolve-is-hq";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
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

// Refusal raised from INSIDE a curriculum transaction, so that a refusal rolls
// the whole thing back rather than committing a half-done change. Same shape and
// same reasoning as SignoffRefusal below; kept separate only so the two domains
// can never be caught by accident for one another.
class CurriculumRefusal extends Error {
  constructor(
    public httpStatus: number,
    public payload: Record<string, unknown>
  ) {
    super(String(payload.code ?? "refused"));
  }
}

// The guard behind BOTH unpublish and unlink: pulling a module out from under a
// trainee who has already started it would leave their progress rows pointing at
// topics their /me feed can no longer reach -- progress that is invisible but
// still counted. `deactivate` exists as the soft alternative for exactly the
// cases this refuses.
//
// The two callers deliberately count different things:
//   * unpublish (programId === null) counts EVERY progress row on the module,
//     whatever the enrollment's status. Unpublishing hits every program at once,
//     so the bar is the highest one.
//   * unlink (programId set) counts only rows belonging to LIVE (active or
//     paused) enrollments of THAT program. Removing one link cannot affect
//     another program, and a finished trainee's rows are history -- which is
//     precisely what stays intact either way.
async function countTraineeProgress(
  tx: any,
  moduleId: string,
  programId: string | null
): Promise<number> {
  if (programId === null) {
    const rows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(passport_topic_progress)
      .innerJoin(
        passport_topics,
        eq(passport_topics.id, passport_topic_progress.topic_id)
      )
      .where(eq(passport_topics.module_id, moduleId))
      .execute();
    return Number(rows[0]?.n ?? 0);
  }
  const rows = await tx
    .select({ n: sql<number>`count(*)` })
    .from(passport_topic_progress)
    .innerJoin(
      passport_topics,
      eq(passport_topics.id, passport_topic_progress.topic_id)
    )
    .innerJoin(
      passport_enrollments,
      eq(passport_enrollments.id, passport_topic_progress.enrollment_id)
    )
    .where(
      and(
        eq(passport_topics.module_id, moduleId),
        eq(passport_enrollments.program_id, programId),
        // "Live" is active OR paused, matching the four other places in this
        // file that decide the same thing (the mentor sign-off gate explicitly
        // accepts paused). A trainee on hold has not stopped being a trainee:
        // unlinking under them would strand their progress rows behind a
        // sign-off path that starts 404ing the moment the link disappears.
        inArray(passport_enrollments.status, ["active", "paused"])
      )
    )
    .execute();
  return Number(rows[0]?.n ?? 0);
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

// Refusal raised from INSIDE the sign-off transaction. Throwing (rather than
// set.status + return) rolls the transaction back, so a refused sign-off cannot
// leave behind the level-0 progress row the endpoint inserts before it is able
// to read the current level. Same pattern as EnrollmentNotOpenError above.
class SignoffRefusal extends Error {
  constructor(
    public httpStatus: number,
    public payload: Record<string, unknown>
  ) {
    super(String(payload.code ?? "refused"));
  }
}

// Order matters here, and it is now the OPPOSITE of what it was at first
// commit: `x-real-ip` FIRST, the socket peer only as a fallback.
//
// It flipped because the deploy added the nginx half. The
// `api.office.lesailes.uz` vhost sets `proxy_set_header X-Real-IP $remote_addr`
// directly in its one proxying `location /` (NOT via `include proxy_params` --
// do not grep for that and conclude otherwise), so nginx OVERWRITES the header
// with the real peer on every single request: a client-supplied `X-Real-IP` is
// destroyed before the app ever sees it, and is therefore no longer forgeable.
// Meanwhile the socket peer is now nginx's own loopback address, so a
// peer-first read would stamp `127.0.0.1` into every journal row forever --
// and `passport_signoffs` is append-only, so those rows could never be
// repaired, blinding the fraud detector that compares trainee/mentor IPs and
// subnets.
//
// The peer fallback survives for direct/local calls (tests, curl on the box).
// That is safe because the upstream port is not reachable from the internet:
// ufw allows only "Nginx Full" and "OpenSSH", and the upstream is bound to
// 127.0.0.1.
//
// `x-forwarded-for` is deliberately NEVER read: nginx APPENDS to it rather than
// overwriting it, so it still carries client-controlled values.
//
// This helper is kept byte-identical to its twin -- clientIp in
// tg-controller.ts -- on purpose:
// the trainee side and the mentor side must record IPs the same way for the
// comparison to mean anything.
function adminClientIp(
  server:
    | { requestIP?: (req: Request) => { address?: string } | null }
    | null
    | undefined,
  request: Request,
  headers: Record<string, string | undefined>
): string | null {
  const ip = headers["x-real-ip"]?.trim();
  if (ip) return ip.slice(0, 64);
  const peer = server?.requestIP?.(request)?.address?.trim();
  return peer ? peer.slice(0, 64) : null;
}

// Topic lookup that IS the authorization check, deliberately REPLICATED from
// tg-controller.ts rather than imported: that file is the trainee surface and
// exports nothing of the sort, and a shared helper would couple the mentor path
// to a controller that is being edited in parallel. The joins require the topic
// to be active, its module published AND active, and that module linked to THIS
// enrollment's program -- so a topic id copied out of another program comes back
// null and the caller gets a 404, never a silent sign-off.
//
// `passport_modules.active = true` is part of the check, not decoration:
// `deactivate` is the lever HR reaches for when a module's content is WRONG, and
// it is the ONLY lever available once a trainee has progress on it (unpublish
// refuses then). Without this predicate the emergency stop stopped nothing --
// the module vanished from the trainee's /me feed while a stale client could
// still submit its quizzes and a mentor could still sign it off. Symmetric with
// the /me filter in tg-controller.ts, and with its twin loadTopicInEnrollment,
// which is kept byte-identical to this function on purpose.
async function loadTopicInProgram(
  drizzle: any,
  topicId: string,
  programId: string
) {
  const [row] = await drizzle
    .select({ topic: passport_topics })
    .from(passport_topics)
    .innerJoin(
      passport_modules,
      eq(passport_modules.id, passport_topics.module_id)
    )
    .innerJoin(
      passport_program_modules,
      and(
        eq(passport_program_modules.module_id, passport_modules.id),
        eq(passport_program_modules.program_id, programId)
      )
    )
    .where(
      and(
        eq(passport_topics.id, topicId),
        eq(passport_topics.active, true),
        eq(passport_modules.status, "published"),
        eq(passport_modules.active, true)
      )
    )
    .execute();
  return row?.topic ?? null;
}

// Journal/mentor display name. users.first_name and last_name are both
// nullable, and an account created by an integration often has neither — the
// login is the last resort so that a row never renders as an empty string,
// which in an evidence trail reads as "nobody signed this".
function personName(
  firstName: string | null,
  lastName: string | null,
  fallback: string | null
): string | null {
  const name = [firstName, lastName]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
  return name || fallback || null;
}

// observationComplete() dereferences .length on both arrays, so the checklist is
// normalised (and refused) before it ever gets there.
function readObservationChecklist(
  raw: unknown
): { items: unknown[]; questions: unknown[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const cl = raw as { items?: unknown; questions?: unknown };
  if (!Array.isArray(cl.items) || !Array.isArray(cl.questions)) return null;
  return { items: cl.items, questions: cl.questions };
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
      // Retired modules stay out of the builder unless explicitly asked for:
      // the list is the pick-a-module surface, and offering a module that HR
      // deliberately took out of circulation is how it gets attached again.
      // String compare, not t.Boolean: every other query param in this codebase
      // is a raw string, so `?include_inactive=true` is the exact spelling.
      if (query.include_inactive !== "true") {
        conds.push(eq(passport_modules.active, true));
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
      query: t.Object({
        program_id: t.Optional(t.String({ format: "uuid" })),
        include_inactive: t.Optional(t.String()),
      }),
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
        .set({
          status: "published",
          // Publishing is the act of putting a module into circulation, so it
          // always un-hides: without this, deactivating a draft and then
          // publishing it yields a published-but-invisible module, missing from
          // the default admin list AND from the trainee feed. Same trap as the
          // new-version fork above.
          active: true,
          updated_at: new Date().toISOString(),
        })
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
            // NOT inherited from the source: forking a retired (active=false)
            // module would mint a working copy that the builder hides by
            // default, so HR clicks "new version" and the draft vanishes. A
            // fork is an explicit new working copy; it is always visible.
            active: true,
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
  // Unpublish: the repair path for a module published by mistake. Back in
  // `draft` it is editable again (assertModuleEditable unfreezes with the
  // status), so a typo is fixed in place instead of forking a version nobody
  // asked for. `version` deliberately does NOT move -- which is only defensible
  // because the guard below proves nobody was working through this version.
  //
  // The read and the write share one transaction: the count is what authorises
  // the update. Under READ COMMITTED that narrows, but does not close, the
  // check-then-act window (a trainee could start a topic between the count and
  // the UPDATE). The window is milliseconds and the outcome is recoverable by
  // publishing again, so it is not worth a row lock over the whole module.
  .post(
    "/passport/modules/:id/unpublish",
    async ({ drizzle, params, set }) => {
      try {
        return await drizzle.transaction(async (tx) => {
          const [mod] = await tx
            .select()
            .from(passport_modules)
            .where(eq(passport_modules.id, params.id))
            .execute();
          if (!mod) {
            throw new CurriculumRefusal(404, {
              message: "Module not found",
              code: "module_not_found",
            });
          }
          if (mod.status !== "published") {
            throw new CurriculumRefusal(409, {
              message: "Only a published module can be unpublished",
              code: "not_published",
              status: mod.status,
            });
          }
          const used = await countTraineeProgress(tx, params.id, null);
          if (used > 0) {
            throw new CurriculumRefusal(409, {
              message:
                "Module has trainee progress: unpublishing would break their path. Use deactivate, or publish a new version.",
              code: "module_in_use",
              progress_rows: used,
            });
          }
          const [updated] = await tx
            .update(passport_modules)
            .set({ status: "draft", updated_at: new Date().toISOString() })
            .where(eq(passport_modules.id, params.id))
            .returning()
            .execute();
          return updated;
        });
      } catch (e) {
        if (e instanceof CurriculumRefusal) {
          set.status = e.httpStatus;
          return e.payload;
        }
        throw e;
      }
    },
    {
      permission: "passport.curriculum.publish",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  // Deactivate: the soft retirement, and the answer whenever unpublish refuses.
  // It hides the module from the trainee feed and from the builder's default
  // listing while leaving every enrollment, progress row and sign-off exactly
  // where it is -- so it needs no progress guard, and no status guard either:
  // `active` is orthogonal to `status` (a draft can be inactive, and a
  // published-but-inactive module is simply one nobody is fed any more).
  // Idempotent on purpose: deactivating twice is a no-op, not a 409.
  .post(
    "/passport/modules/:id/deactivate",
    async ({ drizzle, params, set }) => {
      const [updated] = await drizzle
        .update(passport_modules)
        .set({ active: false, updated_at: new Date().toISOString() })
        .where(eq(passport_modules.id, params.id))
        .returning()
        .execute();
      if (!updated) {
        set.status = 404;
        return { message: "Module not found", code: "module_not_found" };
      }
      return updated;
    },
    {
      permission: "passport.curriculum.publish",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  )
  .post(
    "/passport/modules/:id/activate",
    async ({ drizzle, params, set }) => {
      const [updated] = await drizzle
        .update(passport_modules)
        .set({ active: true, updated_at: new Date().toISOString() })
        .where(eq(passport_modules.id, params.id))
        .returning()
        .execute();
      if (!updated) {
        set.status = 404;
        return { message: "Module not found", code: "module_not_found" };
      }
      return updated;
    },
    {
      permission: "passport.curriculum.publish",
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
  // Unlink a module from a program. The counterpart to the upsert above, and
  // the only way a mis-attached module leaves a program without hand-written
  // SQL. Refused while active trainees of THIS program have progress on the
  // module -- their rows would survive the delete but the module would vanish
  // from their /me feed. Same one-transaction read+write as unpublish.
  .delete(
    "/passport/program-modules",
    async ({ drizzle, body, set }) => {
      try {
        return await drizzle.transaction(async (tx) => {
          const [link] = await tx
            .select()
            .from(passport_program_modules)
            .where(
              and(
                eq(passport_program_modules.program_id, body.program_id),
                eq(passport_program_modules.module_id, body.module_id)
              )
            )
            .execute();
          if (!link) {
            throw new CurriculumRefusal(404, {
              message: "Link not found",
              code: "link_not_found",
            });
          }
          const used = await countTraineeProgress(
            tx,
            body.module_id,
            body.program_id
          );
          if (used > 0) {
            throw new CurriculumRefusal(409, {
              message:
                "Trainees of this program (active or paused) already have progress on the module. Deactivate the module instead of unlinking it.",
              code: "module_in_use_in_program",
              progress_rows: used,
            });
          }
          await tx
            .delete(passport_program_modules)
            .where(eq(passport_program_modules.id, link.id))
            .execute();
          return {
            deleted: true,
            id: link.id,
            program_id: body.program_id,
            module_id: body.module_id,
          };
        });
      } catch (e) {
        if (e instanceof CurriculumRefusal) {
          set.status = e.httpStatus;
          return e.payload;
        }
        throw e;
      }
    },
    {
      permission: "passport.curriculum.publish",
      body: t.Object({
        program_id: t.String({ format: "uuid" }),
        module_id: t.String({ format: "uuid" }),
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
  )
  // ---- mentor sign-off (stage 1: no QR handshake yet) ----
  //
  // The anti-fraud pair: the quiz is taken by the trainee on their own phone
  // (tg-controller), the practical observation is signed HERE by a different
  // person holding `passport.signoff`. Faking a skill needs two people.
  //
  // Stage 2 adds the QR handshake (physical co-presence proof) and the dual
  // signature; this endpoint is the plain cookie-authenticated sign-off.
  .post(
    "/passport/signoff",
    async ({
      drizzle,
      cacheController,
      user,
      role,
      terminals,
      body,
      set,
      headers,
      request,
      server,
    }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      // 403 for another branch's trainee, 404 for an unknown enrollment.
      const enr = await loadEnrollmentScoped(
        drizzle,
        body.enrollment_id,
        isHQ,
        terminals,
        set
      );
      if (!enr) return { message: "Enrollment is not accessible" };
      // Fast path; the authoritative re-read happens inside the transaction.
      if (enr.status !== "active" && enr.status !== "paused") {
        set.status = 409;
        return {
          code: "enrollment_closed",
          message: "Enrollment is closed",
          status: enr.status,
        };
      }
      const topic = await loadTopicInProgram(
        drizzle,
        body.topic_id,
        enr.program_id
      );
      if (!topic) {
        set.status = 404;
        return {
          code: "topic_not_found",
          message: "Topic is not part of this enrollment's program",
        };
      }
      const vt = topic.verification_type as VerificationType;
      // A topic verified by quiz alone has nothing to observe, at any level.
      // Checked before the checklist (a quiz-only topic legitimately has none)
      // so the caller gets "this topic needs no observation" rather than a
      // misleading "the checklist is broken".
      if (!hasObservation(vt)) {
        set.status = 409;
        return {
          code: "not_observable",
          message: "Topic requires no observation",
          verification_type: vt,
        };
      }
      // `dual` demands a second, asynchronous expert signature on top of the
      // mentor's ("плюс асинхронная вторая подпись эксперта"). hasObservation()
      // is true and needsPhoto() is false for it, so without this branch it
      // would sail through canObserve() and reach level 3 off ONE signature --
      // the same evidence hole the photo guard below closes, and worse: no
      // second-signature column exists on passport_signoffs or
      // passport_topic_progress, so a singly-signed `dual` row would be
      // permanently indistinguishable from a properly co-signed one. The type is
      // authorable (t.Literal("dual") in the topic body schema) and publishable
      // (publish-validation treats it as a plain quiz+observation topic), so
      // nothing else stops HR from shipping one. Refused in BOTH branches, like
      // photo, until the co-signature exists.
      if (vt === "dual") {
        set.status = 409;
        return {
          code: "dual_signature_unsupported",
          message:
            "Topic requires a second expert signature; dual sign-off is not available yet",
          verification_type: vt,
        };
      }
      // Stage 1 accepts no photo. Signing a photo-evidence topic here would
      // certify "does it alone" while the photo its verification_type demands
      // was never taken, and nothing downstream would ever notice the gap.
      // Refused in BOTH branches (decline included) so there is a single rule:
      // this endpoint does not touch photo topics at all until upload exists.
      if (needsPhoto(vt)) {
        set.status = 409;
        return {
          code: "photo_evidence_unsupported",
          message:
            "Topic requires photo evidence; photo sign-off is not available yet",
          verification_type: vt,
        };
      }
      // publish-validation guarantees both arrays on a published observation
      // topic. Re-checked because observationComplete() dereferences .length on
      // both, so a legacy or hand-edited row would be a 500 instead of a guard.
      const checklist = readObservationChecklist(topic.observation_checklist);
      if (!checklist) {
        set.status = 409;
        return {
          code: "checklist_malformed",
          message: "Topic has no usable observation checklist",
        };
      }

      const ip = adminClientIp(server, request, headers);
      let outcome: {
        level: number;
        declined: boolean;
        signoff_id: string;
      };
      try {
        outcome = await drizzle.transaction(async (tx: any) => {
          // ONE row lock, on the progress row, taken in exactly the position the
          // trainee endpoints take it (insert-if-missing -> SELECT FOR UPDATE ->
          // decide -> write). A mentor sign-off and a trainee quiz submit on the
          // same topic therefore serialize on that row instead of both reading a
          // stale level and clobbering each other's write. Deadlock is not a
          // question here: this path takes exactly one row lock, and a
          // single-lock transaction cannot be part of a wait cycle. (Locking the
          // enrollment row too would NOT be free: the trainee transaction holds
          // the progress row and then needs FOR KEY SHARE on the enrollment for
          // its passport_signoffs FK insert, which conflicts with FOR UPDATE --
          // that is the cycle, and it is why the status re-read below is a plain
          // read.)
          await tx
            .insert(passport_topic_progress)
            .values({ enrollment_id: enr.id, topic_id: topic.id, level: 0 })
            .onConflictDoNothing({
              target: [
                passport_topic_progress.enrollment_id,
                passport_topic_progress.topic_id,
              ],
            })
            .execute();

          const [row] = await tx
            .select()
            .from(passport_topic_progress)
            .where(
              and(
                eq(passport_topic_progress.enrollment_id, enr.id),
                eq(passport_topic_progress.topic_id, topic.id)
              )
            )
            .for("update")
            .execute();
          if (!row)
            throw new SignoffRefusal(409, {
              code: "progress_unavailable",
              message: "Could not read topic progress",
            });

          // Re-read under READ COMMITTED after the lock wait: the outer check
          // above can be arbitrarily stale if this request queued behind a
          // trainee transaction. Throwing rolls back the progress row inserted
          // a few lines up, so a refusal leaves no trace.
          const [cur] = await tx
            .select({ status: passport_enrollments.status })
            .from(passport_enrollments)
            .where(eq(passport_enrollments.id, enr.id))
            .execute();
          if (!cur || (cur.status !== "active" && cur.status !== "paused"))
            throw new SignoffRefusal(409, {
              code: "enrollment_closed",
              message: "Enrollment is closed",
              status: cur?.status ?? "missing",
            });

          // The level comes from the LOCKED row, never from a read taken before
          // the lock: a quiz that passed while this request was queued must be
          // what decides whether the trainee may be observed at all.
          const level: number = row.level;
          if (!canObserve(level, vt))
            throw new SignoffRefusal(409, {
              code: "not_observable",
              message:
                "Trainee has not reached the level required for observation, or the topic needs none",
              level,
              verification_type: vt,
            });

          const journal = async (action: "observed" | "observation_declined") => {
            const [j] = await tx
              .insert(passport_signoffs)
              .values({
                enrollment_id: enr.id,
                topic_id: topic.id,
                module_id: topic.module_id,
                action,
                actor_user_id: user!.id,
                terminal_id: enr.terminal_id,
                ip,
                meta: {
                  source: "office",
                  answers: body.answers,
                  checklist_items: checklist.items.length,
                  checklist_questions: checklist.questions.length,
                },
              })
              .returning({ id: passport_signoffs.id })
              .execute();
            return j.id as string;
          };

          // A refusal to certify is evidence, not a no-op: it is journalled with
          // the exact ticks the mentor did give, and the level is left alone.
          if (body.declined === true) {
            return {
              level,
              declined: true,
              signoff_id: await journal("observation_declined"),
            };
          }

          // Every item AND every verbal question must be ticked, and the array
          // lengths must match the checklist. A partially ticked observation is
          // not a pass.
          if (!observationComplete(checklist, body.answers))
            throw new SignoffRefusal(422, {
              code: "observation_incomplete",
              message: "Every checklist item and question must be confirmed",
              expected: {
                items: checklist.items.length,
                questions: checklist.questions.length,
              },
              got: {
                items: body.answers.items.length,
                questions: body.answers.questions.length,
              },
              // Which boxes are still empty, so the UI can point at them
              // instead of just saying "no".
              unticked: {
                items: body.answers.items
                  .map((v, i) => (v ? -1 : i))
                  .filter((i) => i >= 0),
                questions: body.answers.questions
                  .map((v, i) => (v ? -1 : i))
                  .filter((i) => i >= 0),
              },
            });

          const next = levelAfterObserved(level);
          await tx
            .update(passport_topic_progress)
            .set({
              level: next,
              observed_by_user_id: user!.id,
              observed_at: sql`now()`,
              observation_answers: body.answers,
              updated_at: sql`now()`,
            })
            .where(eq(passport_topic_progress.id, row.id))
            .execute();

          return {
            level: next,
            declined: false,
            signoff_id: await journal("observed"),
          };
        });
      } catch (e) {
        if (e instanceof SignoffRefusal) {
          set.status = e.httpStatus;
          return e.payload;
        }
        throw e;
      }
      return outcome;
    },
    {
      permission: "passport.signoff",
      body: t.Object({
        enrollment_id: t.String({ format: "uuid" }),
        topic_id: t.String({ format: "uuid" }),
        answers: t.Object({
          // Bounded: the arrays are stored verbatim in jsonb and compared to a
          // checklist that is never longer than a page.
          items: t.Array(t.Boolean(), { maxItems: 200 }),
          questions: t.Array(t.Boolean(), { maxItems: 200 }),
        }),
        declined: t.Optional(t.Boolean()),
      }),
    }
  )
  // ---- progress matrix (the screen HR lives in) ----
  //
  // Rows are trainees, columns are the modules of their program, and every cell
  // arrives pre-aggregated: the UI paints chips and dates, it never re-derives a
  // level or a deadline rule. `deadlineStatus` is the SAME function the miniapp
  // feed uses, so a module the trainee sees as overdue on their phone is red in
  // HR's grid too.
  //
  // Columns are (program_id, module_id) PAIRS, not modules: `sort`, `required`
  // and `deadline_days` live on passport_program_modules, so the same module in
  // two programs is legitimately two different columns in two different places.
  // With the usual single-program view this degenerates to the flat list the
  // grid wants; when rows span programs the UI selects columns by
  // `column.program_id === row.program_id` and still re-derives nothing.
  //
  // Columns are published AND active modules only -- exactly the /me filter. A
  // module HR retires therefore leaves the grid, and the row totals (defined
  // over the visible columns) move with it. That is deliberate: HR must see the
  // curriculum the trainee is actually being fed. The retired module's progress
  // rows and its sign-offs are untouched and stay readable in the journal.
  //
  // Cost: five queries, no per-row query and no mega-join. One count, one page
  // of enrollments (<=200), one curriculum read for the programs on that page,
  // one topic read for those modules, one progress read for those enrollments.
  // A branch runs tens of trainees, so the in-memory join is a handful of maps.
  .get(
    "/passport/matrix",
    async ({ drizzle, cacheController, user, role, terminals, query }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      const where: (SQLWrapper | undefined)[] = [];
      if (!isHQ) {
        // Fail closed, before any query runs — same rule as GET
        // /passport/enrollments. An unscoped non-HQ user sees nobody, not
        // everybody, and inArray is never handed an empty list.
        if (!terminals.length) return { total: 0, modules: [], rows: [] };
        where.push(inArray(passport_enrollments.terminal_id, terminals));
      }
      // The matrix is a live-cohort screen: the default is who is training NOW
      // (active + paused), because a branch accumulates closed enrollments
      // forever and page 1 would silently fill with last year's leavers.
      // `status=all` opts into history, a concrete status picks one.
      if (!query.status || query.status === "live") {
        where.push(inArray(passport_enrollments.status, ["active", "paused"]));
      } else if (query.status !== "all") {
        where.push(eq(passport_enrollments.status, query.status));
      }
      if (query.terminal_id)
        where.push(eq(passport_enrollments.terminal_id, query.terminal_id));
      if (query.program_id)
        where.push(eq(passport_enrollments.program_id, query.program_id));
      if (query.position) where.push(eq(employees.position, query.position));
      // Brand is not a column on employees or enrollments: it is the code of
      // the organization owning the trainee's terminal ("chopar" | "les").
      if (query.brand) where.push(eq(organization.code, query.brand));
      const whereClause = where.length ? and(...where) : undefined;
      const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 200);
      const offset = Math.max(Number(query.offset ?? 0) || 0, 0);

      // Count and page share one join set on purpose: `position` and `brand`
      // are predicates that live on the joined tables, so the count cannot be
      // taken on the bare base table. Every join here is onto a PRIMARY KEY
      // (employees.id, terminals.id, organization.id, programs.id), so none of
      // them can multiply a row and inflate the total.
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(passport_enrollments)
        .leftJoin(employees, eq(employees.id, passport_enrollments.employee_id))
        .leftJoin(
          terminalsTable,
          eq(terminalsTable.id, passport_enrollments.terminal_id)
        )
        .leftJoin(
          organization,
          eq(organization.id, terminalsTable.organization_id)
        )
        .where(whereClause)
        .execute();
      const total = Number(count[0].count);

      const enrollments = await drizzle
        .select({
          id: passport_enrollments.id,
          employee_id: passport_enrollments.employee_id,
          program_id: passport_enrollments.program_id,
          terminal_id: passport_enrollments.terminal_id,
          status: passport_enrollments.status,
          started_at: passport_enrollments.started_at,
          probation_deadline: passport_enrollments.probation_deadline,
          completed_at: passport_enrollments.completed_at,
          first_name: employees.first_name,
          last_name: employees.last_name,
          position: employees.position,
          brand: organization.code,
          terminal_name: terminalsTable.name,
          program_title_ru: passport_programs.title_ru,
          program_title_uz: passport_programs.title_uz,
        })
        .from(passport_enrollments)
        .leftJoin(employees, eq(employees.id, passport_enrollments.employee_id))
        .leftJoin(
          terminalsTable,
          eq(terminalsTable.id, passport_enrollments.terminal_id)
        )
        .leftJoin(
          organization,
          eq(organization.id, terminalsTable.organization_id)
        )
        .leftJoin(
          passport_programs,
          eq(passport_programs.id, passport_enrollments.program_id)
        )
        // The SAME predicate as the count above. Its first clause is the
        // terminal scope, so leaving it off here does not just miscount -- it
        // serves a branch manager every other branch's trainees. (It was left
        // off in the first draft of this endpoint and the smoke test caught it:
        // total said 1, the body carried 2 rows.)
        .where(whereClause)
        // Deterministic across pages: names first (that is how a human reads a
        // grid), enrollment id as the tiebreaker so two namesakes never swap
        // places between page 1 and page 2.
        .orderBy(
          asc(employees.last_name),
          asc(employees.first_name),
          asc(passport_enrollments.id)
        )
        .limit(limit)
        .offset(offset)
        .execute();
      if (!enrollments.length) return { total, modules: [], rows: [] };

      const programIds = [
        ...new Set(enrollments.map((e: { program_id: string }) => e.program_id)),
      ];
      const links = await drizzle
        .select({
          program_id: passport_program_modules.program_id,
          module_id: passport_modules.id,
          title_ru: passport_modules.title_ru,
          title_uz: passport_modules.title_uz,
          sort: passport_program_modules.sort,
          required: passport_program_modules.required,
          deadline_days: passport_program_modules.deadline_days,
        })
        .from(passport_program_modules)
        .innerJoin(
          passport_modules,
          eq(passport_modules.id, passport_program_modules.module_id)
        )
        .where(
          and(
            inArray(passport_program_modules.program_id, programIds),
            eq(passport_modules.status, "published"),
            eq(passport_modules.active, true)
          )
        )
        .orderBy(
          asc(passport_program_modules.program_id),
          asc(passport_program_modules.sort),
          asc(passport_modules.title_ru)
        )
        .execute();

      const moduleIds = [
        ...new Set(links.map((l: { module_id: string }) => l.module_id)),
      ];
      const topics = moduleIds.length
        ? await drizzle
            .select({
              id: passport_topics.id,
              module_id: passport_topics.module_id,
            })
            .from(passport_topics)
            .where(
              and(
                inArray(passport_topics.module_id, moduleIds),
                eq(passport_topics.active, true)
              )
            )
            .execute()
        : [];
      const topicsByModule = new Map<string, string[]>();
      for (const tp of topics as { id: string; module_id: string }[]) {
        const list = topicsByModule.get(tp.module_id);
        if (list) list.push(tp.id);
        else topicsByModule.set(tp.module_id, [tp.id]);
      }

      const progress = await drizzle
        .select({
          enrollment_id: passport_topic_progress.enrollment_id,
          topic_id: passport_topic_progress.topic_id,
          level: passport_topic_progress.level,
        })
        .from(passport_topic_progress)
        .where(
          inArray(
            passport_topic_progress.enrollment_id,
            enrollments.map((e: { id: string }) => e.id)
          )
        )
        .execute();
      const levelByKey = new Map<string, number>(
        (
          progress as {
            enrollment_id: string;
            topic_id: string;
            level: number;
          }[]
        ).map((p) => [`${p.enrollment_id}:${p.topic_id}`, p.level])
      );

      const columnsByProgram = new Map<string, typeof links>();
      for (const l of links as { program_id: string }[]) {
        const list = columnsByProgram.get(l.program_id);
        if (list) list.push(l as any);
        else columnsByProgram.set(l.program_id, [l] as any);
      }

      const nowMs = Date.now();
      const rows = enrollments.map((e: any) => {
        const columns: any[] = columnsByProgram.get(e.program_id) ?? [];
        let topicsTotal = 0;
        let topicsDone = 0;
        let modulesDone = 0;
        let overdueModules = 0;
        const cells = columns.map((c) => {
          const topicIds = topicsByModule.get(c.module_id) ?? [];
          let done = 0;
          // A module with no active topics has no minimum level to speak of:
          // `null`, not 0, so the UI shows an empty cell rather than a grey
          // "level 0" chip that reads as "the trainee has done nothing".
          let levelMin: number | null = null;
          for (const tid of topicIds) {
            const lvl = levelByKey.get(`${e.id}:${tid}`) ?? 0;
            // Level 3 = "does it alone" — the bar for a topic being finished.
            // 4 ("can teach") is above it, never below.
            if (lvl >= 3) done += 1;
            levelMin = levelMin === null ? lvl : Math.min(levelMin, lvl);
          }
          const complete = topicIds.length > 0 && done === topicIds.length;
          const dl = deadlineStatus(e.started_at, c.deadline_days, nowMs);
          topicsTotal += topicIds.length;
          topicsDone += done;
          if (complete) modulesDone += 1;
          // A finished module is not "overdue" in the metrics bar even if the
          // date has passed — the cell keeps the raw rule, the counter counts
          // what still needs chasing.
          if (!complete && dl.deadline_status === "overdue") overdueModules += 1;
          return {
            module_id: c.module_id,
            topics_total: topicIds.length,
            topics_done: done,
            level_min: levelMin,
            complete,
            required: c.required,
            deadline_days: c.deadline_days,
            ...dl,
          };
        });
        return {
          enrollment_id: e.id,
          program_id: e.program_id,
          program_title_ru: e.program_title_ru,
          program_title_uz: e.program_title_uz,
          employee: {
            id: e.employee_id,
            first_name: e.first_name,
            last_name: e.last_name,
            position: e.position,
          },
          terminal_id: e.terminal_id,
          terminal_name: e.terminal_name,
          brand: e.brand,
          status: e.status,
          started_at: e.started_at,
          probation_deadline: e.probation_deadline,
          completed_at: e.completed_at,
          totals: {
            modules_total: cells.length,
            modules_done: modulesDone,
            topics_total: topicsTotal,
            topics_done: topicsDone,
            overdue_modules: overdueModules,
          },
          cells,
        };
      });

      return { total, modules: links, rows };
    },
    {
      permission: "passport.matrix.view",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        brand: t.Optional(t.String()),
        terminal_id: t.Optional(t.String({ format: "uuid" })),
        program_id: t.Optional(t.String({ format: "uuid" })),
        position: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("live"),
            t.Literal("all"),
            t.Literal("active"),
            t.Literal("paused"),
            t.Literal("completed"),
            t.Literal("failed"),
          ])
        ),
      }),
    }
  )
  // ---- enrollment journal (the evidence trail) ----
  //
  // passport_signoffs is append-only, and this is the only way HR reads it: who
  // certified what, from which IP, when. Actor uuids are resolved to names here
  // rather than in the UI — a uuid tells an HR manager nothing, and the UI has
  // no business fetching the whole users table to find out.
  //
  // No status filter of any kind: the journal is HISTORY. A completed, failed or
  // paused enrollment still returns its rows, and rows about a module that has
  // since been deactivated or unpublished stay readable — that is the entire
  // point of keeping them.
  .get(
    "/passport/enrollments/:id/journal",
    async ({
      drizzle,
      cacheController,
      user,
      role,
      terminals,
      params,
      query,
      set,
    }) => {
      const isHQ = await resolveIsHq({ user, role, cacheController });
      // 404 unknown, 403 another branch's trainee — the same scope gate the
      // sign-off endpoint uses, so the journal can never become the way to read
      // a record you may not sign.
      const enr = await loadEnrollmentScoped(
        drizzle,
        params.id,
        isHQ,
        terminals,
        set
      );
      if (!enr) return { message: "Enrollment is not accessible" };
      const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
      const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(passport_signoffs)
        .where(eq(passport_signoffs.enrollment_id, params.id))
        .execute();
      const data = await drizzle
        .select({
          id: passport_signoffs.id,
          created_at: passport_signoffs.created_at,
          action: passport_signoffs.action,
          topic_id: passport_signoffs.topic_id,
          topic_title_ru: passport_topics.title_ru,
          topic_title_uz: passport_topics.title_uz,
          module_id: passport_signoffs.module_id,
          module_title_ru: passport_modules.title_ru,
          module_title_uz: passport_modules.title_uz,
          terminal_id: passport_signoffs.terminal_id,
          ip: passport_signoffs.ip,
          meta: passport_signoffs.meta,
          actor_user_id: passport_signoffs.actor_user_id,
          actor_user_login: users.login,
          actor_user_first_name: users.first_name,
          actor_user_last_name: users.last_name,
          actor_employee_id: passport_signoffs.actor_employee_id,
          actor_employee_first_name: employees.first_name,
          actor_employee_last_name: employees.last_name,
        })
        .from(passport_signoffs)
        // All four are leftJoins on primary keys: an actor column is nullable
        // (a trainee-side event has no user, an office event has no employee),
        // and topic_id / module_id are plain uuids with no FK — a row about a
        // hard-deleted topic must still appear, with a null title, rather than
        // disappear from the evidence.
        .leftJoin(users, eq(users.id, passport_signoffs.actor_user_id))
        .leftJoin(
          employees,
          eq(employees.id, passport_signoffs.actor_employee_id)
        )
        .leftJoin(
          passport_topics,
          eq(passport_topics.id, passport_signoffs.topic_id)
        )
        .leftJoin(
          passport_modules,
          eq(passport_modules.id, passport_signoffs.module_id)
        )
        .where(eq(passport_signoffs.enrollment_id, params.id))
        // Newest first; id breaks ties so that two events written in the same
        // millisecond keep a stable order across pages.
        .orderBy(desc(passport_signoffs.created_at), desc(passport_signoffs.id))
        .limit(limit)
        .offset(offset)
        .execute();
      return {
        total: Number(count[0].count),
        enrollment: {
          id: enr.id,
          employee_id: enr.employee_id,
          program_id: enr.program_id,
          terminal_id: enr.terminal_id,
          status: enr.status,
          started_at: enr.started_at,
        },
        data: data.map((r: any) => ({
          id: r.id,
          created_at: r.created_at,
          action: r.action,
          topic: r.topic_id
            ? {
                id: r.topic_id,
                title_ru: r.topic_title_ru,
                title_uz: r.topic_title_uz,
              }
            : null,
          module: r.module_id
            ? {
                id: r.module_id,
                title_ru: r.module_title_ru,
                title_uz: r.module_title_uz,
              }
            : null,
          actor: {
            // "office" = an admin/mentor acting through the panel, "trainee" =
            // the phone. `null` is a system-written row.
            kind: r.actor_user_id
              ? "office"
              : r.actor_employee_id
                ? "trainee"
                : null,
            user_id: r.actor_user_id,
            employee_id: r.actor_employee_id,
            name: r.actor_user_id
              ? personName(
                  r.actor_user_first_name,
                  r.actor_user_last_name,
                  r.actor_user_login
                )
              : r.actor_employee_id
                ? personName(
                    r.actor_employee_first_name,
                    r.actor_employee_last_name,
                    null
                  )
                : null,
          },
          terminal_id: r.terminal_id,
          ip: r.ip,
          meta: r.meta,
        })),
      };
    },
    {
      permission: "passport.matrix.view",
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )
  // ---- mentor telegram bindings ----
  //
  // A trainee gets their binding by scanning a QR (tg/auth redeems an invite).
  // A mentor has no QR and no invite: without a row here a branch manager
  // cannot log into the miniapp AT ALL, so this is HR's only way to let one in.
  // Mentor = user_id set, employee_id null — that is exactly how tg/auth
  // resolves the role (`employee_id ? "trainee" : "mentor"`), so the list is
  // filtered on the same pair rather than on user_id alone.
  .get(
    "/passport/mentors",
    async ({ drizzle, query }) => {
      const conds = [
        isNotNull(passport_tg_bindings.user_id),
        isNull(passport_tg_bindings.employee_id),
      ];
      if (query.user_id)
        conds.push(eq(passport_tg_bindings.user_id, query.user_id));
      const whereClause = and(...conds);
      const limit = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 200);
      const offset = Math.max(Number(query.offset ?? 0) || 0, 0);
      const count = await drizzle
        .select({ count: sql<number>`count(*)` })
        .from(passport_tg_bindings)
        .where(whereClause)
        .execute();
      const data = await drizzle
        .select({
          id: passport_tg_bindings.id,
          telegram_id: passport_tg_bindings.telegram_id,
          user_id: passport_tg_bindings.user_id,
          first_name: passport_tg_bindings.first_name,
          lang: passport_tg_bindings.lang,
          banned: passport_tg_bindings.banned,
          created_at: passport_tg_bindings.created_at,
          user_login: users.login,
          user_first_name: users.first_name,
          user_last_name: users.last_name,
          user_status: users.status,
        })
        .from(passport_tg_bindings)
        .leftJoin(users, eq(users.id, passport_tg_bindings.user_id))
        .where(whereClause)
        .orderBy(desc(passport_tg_bindings.created_at))
        .limit(limit)
        .offset(offset)
        .execute();
      return {
        total: Number(count[0].count),
        data: data.map((r: any) => ({
          id: r.id,
          telegram_id: r.telegram_id,
          user_id: r.user_id,
          // The name telegram gave us when the account last authenticated —
          // empty until the mentor's first login, which is itself the signal
          // HR wants ("did he ever actually get in?").
          tg_first_name: r.first_name,
          lang: r.lang,
          banned: r.banned,
          created_at: r.created_at,
          user: r.user_id
            ? {
                id: r.user_id,
                login: r.user_login,
                first_name: r.user_first_name,
                last_name: r.user_last_name,
                status: r.user_status,
                name: personName(r.user_first_name, r.user_last_name, r.user_login),
              }
            : null,
        })),
      };
    },
    {
      permission: "passport.mentors.manage",
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        user_id: t.Optional(t.String({ format: "uuid" })),
      }),
    }
  )
  .post(
    "/passport/mentors",
    async ({ drizzle, body, set }) => {
      try {
        return await drizzle.transaction(async (tx) => {
          const [target] = await tx
            .select({ id: users.id, login: users.login })
            .from(users)
            .where(eq(users.id, body.user_id))
            .execute();
          if (!target)
            throw new CurriculumRefusal(404, {
              message: "User not found",
              code: "user_not_found",
            });
          // telegram_id is UNIQUE, and the decision below is a check-then-act
          // on that row. Two HR managers binding the same telegram_id at the
          // same moment would otherwise both read "free" and the loser would
          // get a raw unique-violation 500. Same advisory-lock pattern as
          // POST /passport/enrollments; held to end of transaction, and it only
          // ever collides with another binding of the SAME telegram id.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${"passport_tg:" + String(body.telegram_id)}))`
          );
          const [existing] = await tx
            .select()
            .from(passport_tg_bindings)
            .where(eq(passport_tg_bindings.telegram_id, body.telegram_id))
            .execute();
          if (existing) {
            // THE guard. This telegram account is a trainee's: overwriting it
            // with user_id would flip its role to mentor (tg/auth reads
            // `employee_id ? trainee : mentor`), the trainee would lose their
            // own passport, and whoever holds the phone would gain sign-off
            // reach over the branch. tg/auth already refuses the mirror image
            // of this from the invite side ("wrong_account"); this is the same
            // takeover coming from the admin side, and it is refused here.
            if (existing.employee_id) {
              throw new CurriculumRefusal(409, {
                message:
                  "This telegram account belongs to a trainee and cannot be bound as a mentor",
                code: "telegram_bound_to_trainee",
                telegram_id: body.telegram_id,
              });
            }
            if (existing.user_id && existing.user_id !== body.user_id) {
              throw new CurriculumRefusal(409, {
                message:
                  "This telegram account is already bound to another user. Unbind it first.",
                code: "telegram_bound_to_other_user",
                telegram_id: body.telegram_id,
                user_id: existing.user_id,
              });
            }
            // Same user, again: idempotent. `banned` is deliberately NOT
            // cleared — un-banning is its own decision, not a side effect of
            // re-saving a binding that already exists.
            const [updated] = await tx
              .update(passport_tg_bindings)
              .set({
                user_id: body.user_id,
                ...(body.lang ? { lang: body.lang } : {}),
              })
              .where(eq(passport_tg_bindings.id, existing.id))
              .returning()
              .execute();
            return { created: false, ...updated };
          }
          const [row] = await tx
            .insert(passport_tg_bindings)
            .values({
              telegram_id: body.telegram_id,
              user_id: body.user_id,
              // employee_id stays null: that null IS the mentor role.
              lang: body.lang ?? "ru",
            })
            .returning()
            .execute();
          return { created: true, ...row };
        });
      } catch (e) {
        if (e instanceof CurriculumRefusal) {
          set.status = e.httpStatus;
          return e.payload;
        }
        throw e;
      }
    },
    {
      permission: "passport.mentors.manage",
      body: t.Object({
        user_id: t.String({ format: "uuid" }),
        // Telegram ids are positive and comfortably inside 2^53 (the column is
        // a bigint read in JS number mode), so the bound is the safe-integer
        // limit rather than bigint's.
        telegram_id: t.Integer({ minimum: 1, maximum: 9007199254740991 }),
        lang: t.Optional(t.Union([t.Literal("ru"), t.Literal("uz")])),
      }),
    }
  )
  // Unbind: the mentor loses miniapp access. Deleting the row (rather than
  // setting `banned`) is what HR asked for — "снять привязку" — and it leaves
  // the telegram id free to be bound to somebody else, which `banned` would not.
  //
  // KNOWN GAP, pre-existing and shared with `banned`: a Bearer session already
  // issued lives in Redis for up to 12h and is never re-checked against this
  // table (see passportTgCtx), so access ends within that window rather than
  // instantly. Closing it needs a binding->token index in the auth path.
  .delete(
    "/passport/mentors/:telegram_id",
    async ({ drizzle, params, set }) => {
      const telegramId = Number(params.telegram_id);
      if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
        set.status = 422;
        return { message: "Bad telegram_id", code: "bad_telegram_id" };
      }
      const [existing] = await drizzle
        .select()
        .from(passport_tg_bindings)
        .where(eq(passport_tg_bindings.telegram_id, telegramId))
        .execute();
      if (!existing) {
        set.status = 404;
        return { message: "Binding not found", code: "binding_not_found" };
      }
      // The mentors surface does not unbind trainees, in either direction: a
      // trainee's binding is created by redeeming their invite and is removed
      // by HR closing the enrollment, not by a stray DELETE here.
      if (existing.employee_id) {
        set.status = 409;
        return {
          message: "This binding belongs to a trainee, not a mentor",
          code: "binding_is_trainee",
          telegram_id: telegramId,
        };
      }
      await drizzle
        .delete(passport_tg_bindings)
        .where(eq(passport_tg_bindings.id, existing.id))
        .execute();
      return {
        deleted: true,
        id: existing.id,
        telegram_id: telegramId,
        user_id: existing.user_id,
      };
    },
    {
      permission: "passport.mentors.manage",
      // Numeric path param, validated as digits and then bounds-checked in the
      // handler: a bigint that overflows JS's safe range must be refused, not
      // silently rounded into somebody else's binding.
      params: t.Object({ telegram_id: t.String({ pattern: "^[0-9]{1,19}$" }) }),
    }
  );

export const passportController = passportControllerImpl as unknown as Elysia;
