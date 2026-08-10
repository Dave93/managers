import { ctx } from "@backend/context";
import {
  attestation_test_attempt_answers,
  attestation_test_attempts,
  attestation_test_question_options,
  attestation_test_questions,
  attestation_tests,
  passport_enrollments,
  passport_invites,
  passport_modules,
  passport_program_modules,
  passport_programs,
  passport_signoffs,
  passport_stamps,
  passport_tg_bindings,
  passport_topic_progress,
  passport_topics,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { randomUUID } from "crypto";
import { parseInviteStartParam, verifyInitData } from "./tg-auth";
import {
  PASSPORT_TG_SESSION_TTL_SEC,
  passportTgCtx,
  passportTgSessionKey,
  type PassportTgSession,
} from "./tg-ctx";
import { deadlineStatus, parseTimestamp } from "./deadline";
import {
  hasObservation,
  hasQuiz,
  levelAfterMaterialOpened,
  levelAfterQuizPassed,
  type VerificationType,
} from "./state";
import {
  gradeAttempt,
  pickQuestionIds,
  shuffleWithRng,
  type GradableQuestion,
} from "@backend/modules/attestation/grading";

const QUIZ_COOLDOWN_SEC = 3600;
const QUIZ_FAIL_LIMIT = 2;

// Prefixed like every other key in this codebase (see passportTgSessionKey):
// the plan text spells the key without PROJECT_PREFIX, but an unprefixed key
// would collide across the deployments sharing this Redis.
function quizCooldownKey(enrollmentId: string, topicId: string): string {
  return `${process.env.PROJECT_PREFIX}passport_quiz_cd:${enrollmentId}:${topicId}`;
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
// This helper is kept byte-identical to its twin -- adminClientIp in
// controller.ts -- on purpose:
// the trainee side and the mentor side must record IPs the same way for the
// comparison to mean anything.
function clientIp(
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

// These routes are the TRAINEE's. `passportTgCtx` also admits mentor sessions
// (user_id set, employee_id null); letting one through would build queries
// around a null employee id. Fails closed if tgSession is somehow absent.
function traineeOrForbidden(
  tgSession: PassportTgSession | undefined,
  set: { status?: number | string }
): { employee_id: string } | null {
  if (!tgSession || tgSession.role !== "trainee" || !tgSession.employee_id) {
    set.status = 403;
    return null;
  }
  return { employee_id: tgSession.employee_id };
}

// The ONE enrollment a session may touch. An employee can accumulate several
// (re-enrolled after a failure, or moved to a second program), so this is
// resolved in exactly one place and reused by every endpoint: /me and the quiz
// routes can never end up disagreeing about which passport is open. Active
// only, newest first.
async function loadTraineeEnrollment(drizzle: any, employeeId: string) {
  const [enrollment] = await drizzle
    .select()
    .from(passport_enrollments)
    .where(
      and(
        eq(passport_enrollments.employee_id, employeeId),
        eq(passport_enrollments.status, "active")
      )
    )
    .orderBy(desc(passport_enrollments.started_at))
    .limit(1)
    .execute();
  return enrollment ?? null;
}

// Topic lookup that IS the authorization check: the joins require the topic's
// module to be published, still ACTIVE, and linked to this enrollment's
// program. A topic id copied from another trainee's program comes back null ->
// 404, never served.
//
// `passport_modules.active = true` matches the /me feed filter below, and it is
// what makes `deactivate` an actual emergency stop: HR deactivates a module the
// moment its content is found to be wrong (and once a trainee has progress on
// it, deactivate is the ONLY move -- unpublish refuses). Before this predicate a
// client that already had the topic list cached could still open the material,
// start and submit quizzes on a withdrawn module. All three call sites below
// (material-open, quiz start, quiz submit) now fail safe to 404, as does the
// mentor sign-off through the byte-identical twin loadTopicInProgram in
// controller.ts.
async function loadTopicInEnrollment(
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

// Telegram miniapp entry point.
//
// Registered on the app root (src/app.ts) next to passportController, NOT in
// controllers.ts: apiController's .use() chain is already at TypeScript's
// instantiation-depth limit and one more controller there overflows it
// (TS2589 — see the comment above creditAdminControllerImpl). Hence the
// explicit /api prefix here.
//
// Nothing in this module logs init_data, the bot token or the session token.
const passportTgControllerImpl = new Elysia({
  name: "@api/passport_tg",
  prefix: "/api",
})
  .use(ctx)
  .post(
    "/passport/tg/auth",
    async ({ body, drizzle, redis, set }) => {
      const botToken = process.env.PASSPORT_BOT_TOKEN;
      // Fail closed. verifyInitData also refuses an empty key, but an
      // unconfigured deployment should say so rather than look like a bad
      // signature.
      if (!botToken) {
        set.status = 503;
        return { error: "not_configured" };
      }

      const verified = verifyInitData(
        body.init_data,
        botToken,
        Math.floor(Date.now() / 1000)
      );
      if (!verified.ok) {
        set.status = 401;
        return { error: "bad_init_data" };
      }

      // Order matters: look the binding up BEFORE touching the invite, so a
      // banned user cannot burn a fresh invite on their way to a 403.
      const [existing] = await drizzle
        .select()
        .from(passport_tg_bindings)
        .where(eq(passport_tg_bindings.telegram_id, verified.telegramId))
        .execute();

      if (existing?.banned === true) {
        set.status = 403;
        return { error: "banned" };
      }

      let binding = existing ?? null;

      const inviteId = parseInviteStartParam(verified.startParam);
      if (inviteId) {
        // Pre-flight: WHOSE invite is this? An invite must never be able to
        // repoint an account that is already bound to somebody else.
        //
        // Without this check, trainee A scanning trainee B's QR code would burn
        // B's invite AND have A's binding silently rewritten to employee B —
        // A then reads and completes B's training record. Same shape for a
        // mentor binding (user_id set, employee_id null): the upsert would
        // write employee_id, and since role resolution is
        // `employee_id ? "trainee" : "mentor"`, the mentor would silently lose
        // mentor access.
        //
        // This read only REFUSES early. It is not the claim — the conditional
        // UPDATE below remains the single atomic claim on the invite, so the
        // concurrency property is untouched. And, exactly like the `banned`
        // check above, a refusal here does NOT touch used_at: a bystander must
        // not be able to burn someone else's invite.
        const [target] = await drizzle
          .select({ employee_id: passport_enrollments.employee_id })
          .from(passport_invites)
          .innerJoin(
            passport_enrollments,
            eq(passport_enrollments.id, passport_invites.enrollment_id)
          )
          .where(eq(passport_invites.id, inviteId))
          .execute();

        // No such invite: nothing to claim, and the conditional UPDATE below
        // would match nothing anyway. Fall through to the binding lookup.
        if (target) {
          const boundElsewhere =
            existing != null &&
            (existing.user_id != null ||
              (existing.employee_id != null &&
                existing.employee_id !== target.employee_id));
          if (boundElsewhere) {
            set.status = 403;
            return { error: "wrong_account" };
          }

          // All-or-nothing. The redeem used to commit independently of the
          // binding upsert, so an error in between left the invite burned with
          // no binding — the trainee locked out until HR reissued. Every
          // statement below uses `tx`, never the outer `drizzle`: mixing the
          // two silently runs the statement outside the transaction.
          const saved = await drizzle.transaction(async (tx) => {
            // Single-use redemption, concurrency-safe: the WHERE clause is the
            // lock. Only the transaction whose UPDATE matches an unused,
            // unexpired row gets a RETURNING row; a second concurrent
            // redemption of the same invite matches nothing and falls through
            // to the binding lookup below (403 no_access if that user has no
            // binding of their own). Both time predicates use in-DB now()
            // rather than a JS timestamp.
            const [redeemed] = await tx
              .update(passport_invites)
              .set({ used_at: sql`now()` })
              .where(
                and(
                  eq(passport_invites.id, inviteId),
                  isNull(passport_invites.used_at),
                  sql`${passport_invites.expires_at} > now()`
                )
              )
              .returning({ enrollment_id: passport_invites.enrollment_id })
              .execute();

            // Already used, or expired. Re-entry with an invite this account
            // already redeemed lands here and is fine: the binding lookup
            // outside still issues a session.
            if (!redeemed) return null;

            const [enrollment] = await tx
              .select({ employee_id: passport_enrollments.employee_id })
              .from(passport_enrollments)
              .where(eq(passport_enrollments.id, redeemed.enrollment_id))
              .execute();
            // Unreachable in practice (enrollment_id is an FK), but throwing
            // rather than returning is the point: it rolls the burn back
            // instead of committing a consumed invite with no binding.
            if (!enrollment) {
              throw new Error("passport: invite points at a missing enrollment");
            }

            // `banned` and `lang` are intentionally absent from the update
            // set: a banned trainee must not be able to clear the flag by
            // redeeming a new invite, and a chosen UI language must survive.
            const [row] = await tx
              .insert(passport_tg_bindings)
              .values({
                telegram_id: verified.telegramId,
                employee_id: enrollment.employee_id,
                first_name: verified.firstName,
              })
              .onConflictDoUpdate({
                target: passport_tg_bindings.telegram_id,
                set: {
                  employee_id: enrollment.employee_id,
                  first_name: verified.firstName,
                },
              })
              .returning()
              .execute();
            return row ?? null;
          });
          binding = saved ?? binding;
        }
      }

      // No binding, and no valid invite to create one. Mentor bindings are
      // created by HR in the admin (Plan 1b); here we only look them up.
      if (!binding || (!binding.employee_id && !binding.user_id)) {
        set.status = 403;
        return { error: "no_access" };
      }
      if (binding.banned === true) {
        set.status = 403;
        return { error: "banned" };
      }

      const role: "trainee" | "mentor" = binding.employee_id
        ? "trainee"
        : "mentor";
      const token = randomUUID();
      const session: PassportTgSession = {
        binding_id: binding.id,
        employee_id: binding.employee_id ?? null,
        user_id: binding.user_id ?? null,
        telegram_id: verified.telegramId,
        role,
        lang: binding.lang,
      };
      await redis.set(
        passportTgSessionKey(token),
        JSON.stringify(session),
        "EX",
        PASSPORT_TG_SESSION_TTL_SEC
      );

      return {
        token,
        expires_at: new Date(
          Date.now() + PASSPORT_TG_SESSION_TTL_SEC * 1000
        ).toISOString(),
        role,
        lang: binding.lang,
      };
    },
    {
      body: t.Object({
        init_data: t.String(),
      }),
    }
  )
  // ---------------------------------------------------------------------
  // Everything below is the trainee's own phone talking. `passportTgCtx` is
  // mounted HERE, after /passport/tg/auth: Elysia applies a plugin's hooks
  // only to routes registered after the `.use()`, so auth stays public while
  // every route beneath requires a Bearer session. Verified live — a request
  // with no Authorization header to /passport/tg/me returns
  // 401 {"error":"unauthorized"}, and /passport/tg/auth still answers
  // {"error":"bad_init_data"} rather than "unauthorized".
  //
  // Nothing here trusts the client for identity, scope, level or score: the
  // enrollment comes from the session, the topic must belong to that
  // enrollment's program, and levels only ever move through state.ts.
  .use(passportTgCtx)
  .get(
    "/passport/tg/me",
    async ({ tgSession, drizzle, set }) => {
      const guard = traineeOrForbidden(tgSession, set);
      if (!guard) return { error: "forbidden" };

      const enrollment = await loadTraineeEnrollment(drizzle, guard.employee_id);
      if (!enrollment) {
        set.status = 404;
        return { error: "no_enrollment" };
      }

      const [program] = await drizzle
        .select()
        .from(passport_programs)
        .where(eq(passport_programs.id, enrollment.program_id))
        .execute();

      // Only published AND active modules of THIS program, in the program's own
      // order. `active = false` is HR retiring a module without disturbing
      // history: it leaves the feed here, while every progress row and sign-off
      // already recorded against it stays exactly where it is.
      const links = await drizzle
        .select({ link: passport_program_modules, module: passport_modules })
        .from(passport_program_modules)
        .innerJoin(
          passport_modules,
          eq(passport_modules.id, passport_program_modules.module_id)
        )
        .where(
          and(
            eq(passport_program_modules.program_id, enrollment.program_id),
            eq(passport_modules.status, "published"),
            eq(passport_modules.active, true)
          )
        )
        .orderBy(asc(passport_program_modules.sort))
        .execute();

      const moduleIds = links.map((l: any) => l.module.id);
      const topics = moduleIds.length
        ? await drizzle
            .select()
            .from(passport_topics)
            .where(
              and(
                inArray(passport_topics.module_id, moduleIds),
                eq(passport_topics.active, true)
              )
            )
            .orderBy(asc(passport_topics.sort))
            .execute()
        : [];

      const progress = await drizzle
        .select()
        .from(passport_topic_progress)
        .where(eq(passport_topic_progress.enrollment_id, enrollment.id))
        .execute();
      const levelByTopic = new Map<string, number>(
        progress.map((p: any) => [p.topic_id, p.level])
      );

      const stamps = await drizzle
        .select()
        .from(passport_stamps)
        .where(eq(passport_stamps.enrollment_id, enrollment.id))
        .execute();

      const nowMs = Date.now();
      return {
        enrollment: {
          id: enrollment.id,
          status: enrollment.status,
          started_at: enrollment.started_at,
          probation_deadline: enrollment.probation_deadline,
          terminal_id: enrollment.terminal_id,
          program_id: enrollment.program_id,
        },
        program: program
          ? {
              id: program.id,
              position: program.position,
              title_ru: program.title_ru,
              title_uz: program.title_uz,
            }
          : null,
        modules: links.map((l: any) => ({
          module: {
            id: l.module.id,
            title_ru: l.module.title_ru,
            title_uz: l.module.title_uz,
            brand: l.module.brand,
            version: l.module.version,
            owner_department: l.module.owner_department,
          },
          sort: l.link.sort,
          required: l.link.required,
          deadline_days: l.link.deadline_days,
          ...deadlineStatus(
            enrollment.started_at,
            l.link.deadline_days,
            nowMs
          ),
          topics: topics
            .filter((tp: any) => tp.module_id === l.module.id)
            .map((tp: any) => ({
              topic: {
                id: tp.id,
                sort: tp.sort,
                title_ru: tp.title_ru,
                title_uz: tp.title_uz,
                step_ru: tp.step_ru,
                step_uz: tp.step_uz,
                key_point_ru: tp.key_point_ru,
                key_point_uz: tp.key_point_uz,
                reason_ru: tp.reason_ru,
                reason_uz: tp.reason_uz,
                video_id: tp.video_id,
                verification_type: tp.verification_type,
                // The quiz test id itself stays server-side; the client only
                // needs to know whether the button exists.
                has_quiz:
                  hasQuiz(tp.verification_type as VerificationType) &&
                  tp.quiz_test_id != null,
                has_observation: hasObservation(
                  tp.verification_type as VerificationType
                ),
              },
              level: levelByTopic.get(tp.id) ?? 0,
            })),
        })),
        stamps: stamps.map((s: any) => ({
          id: s.id,
          type: s.type,
          module_id: s.module_id,
          issued_at: s.issued_at,
          valid_until: s.valid_until,
        })),
      };
    }
  )
  // ---- material opened (idempotent) ----
  .post(
    "/passport/tg/topics/:id/opened",
    async ({ tgSession, params: { id }, drizzle, headers, server, request, set }) => {
      const guard = traineeOrForbidden(tgSession, set);
      if (!guard) return { error: "forbidden" };

      const enrollment = await loadTraineeEnrollment(drizzle, guard.employee_id);
      if (!enrollment) {
        set.status = 404;
        return { error: "no_enrollment" };
      }
      const topic = await loadTopicInEnrollment(
        drizzle,
        id,
        enrollment.program_id
      );
      if (!topic) {
        set.status = 404;
        return { error: "topic_not_found" };
      }

      const ip = clientIp(server, request, headers);
      // The whole read-modify-write is one transaction and the progress row is
      // locked FOR UPDATE. A double-tap on the phone fires two identical
      // requests; without the lock both would read level 0 and both would
      // journal `material_opened`. With it, the loser re-reads the committed
      // level 1, sees no transition, and writes nothing.
      const result = await drizzle.transaction(async (tx: any) => {
        await tx
          .insert(passport_topic_progress)
          .values({ enrollment_id: enrollment.id, topic_id: topic.id, level: 0 })
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
              eq(passport_topic_progress.enrollment_id, enrollment.id),
              eq(passport_topic_progress.topic_id, topic.id)
            )
          )
          .for("update")
          .execute();

        const current: number = row?.level ?? 0;
        const next = levelAfterMaterialOpened(current);
        if (next === current) return { level: current, recorded: false };

        await tx
          .update(passport_topic_progress)
          .set({ level: next, updated_at: sql`now()` })
          .where(eq(passport_topic_progress.id, row.id))
          .execute();

        await tx
          .insert(passport_signoffs)
          .values({
            enrollment_id: enrollment.id,
            topic_id: topic.id,
            module_id: topic.module_id,
            action: "material_opened",
            actor_employee_id: guard.employee_id,
            terminal_id: enrollment.terminal_id,
            ip,
            meta: { source: "miniapp" },
          })
          .execute();

        return { level: next, recorded: true };
      });

      return result;
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )
  // ---- quiz start (attestation engine, source=miniapp) ----
  .post(
    "/passport/tg/quiz/:topicId/start",
    async ({ tgSession, params: { topicId }, drizzle, redis, set }) => {
      const guard = traineeOrForbidden(tgSession, set);
      if (!guard) return { error: "forbidden" };

      const enrollment = await loadTraineeEnrollment(drizzle, guard.employee_id);
      if (!enrollment) {
        set.status = 404;
        return { error: "no_enrollment" };
      }
      const topic = await loadTopicInEnrollment(
        drizzle,
        topicId,
        enrollment.program_id
      );
      if (!topic) {
        set.status = 404;
        return { error: "topic_not_found" };
      }
      if (
        !hasQuiz(topic.verification_type as VerificationType) ||
        !topic.quiz_test_id
      ) {
        set.status = 400;
        return { error: "no_quiz" };
      }

      const [progress] = await drizzle
        .select()
        .from(passport_topic_progress)
        .where(
          and(
            eq(passport_topic_progress.enrollment_id, enrollment.id),
            eq(passport_topic_progress.topic_id, topic.id)
          )
        )
        .execute();

      // Level >= 2 means the quiz is already behind them (a failed recheck
      // rolls back to 2, i.e. re-observation, never back to the quiz).
      if ((progress?.level ?? 0) >= 2) {
        set.status = 409;
        return { error: "already_passed", level: progress.level };
      }

      // Anti-brute-force. Two consecutive failures inside the window park the
      // topic for an hour; the counter is cleared on a pass.
      const cdKey = quizCooldownKey(enrollment.id, topic.id);
      const fails = parseInt((await redis.get(cdKey)) ?? "0", 10);
      if (fails >= QUIZ_FAIL_LIMIT) {
        const ttl = await redis.ttl(cdKey);
        set.status = 429;
        return {
          error: "cooldown",
          retry_after_sec: ttl > 0 ? ttl : QUIZ_COOLDOWN_SEC,
        };
      }

      const [test] = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, topic.quiz_test_id))
        .execute();
      if (!test || !test.active) {
        set.status = 404;
        return { error: "test_not_found" };
      }

      const questions = await drizzle
        .select()
        .from(attestation_test_questions)
        .where(
          and(
            eq(attestation_test_questions.test_id, test.id),
            eq(attestation_test_questions.active, true)
          )
        )
        .execute();
      if (!questions.length) {
        set.status = 400;
        return { error: "test_has_no_questions" };
      }

      const rng = Math.random;

      // Sampling is a pure read of immutable rows, so it happens outside the
      // lock; whether this sampled paper is actually used is decided inside it.
      const pickedIds = pickQuestionIds(
        questions.map((q: any) => q.id),
        test.questions_per_attempt,
        rng
      );
      const candidateIds = test.shuffle_questions
        ? shuffleWithRng(pickedIds, rng)
        : pickedIds;

      // Same lock discipline as /opened, and for a sharper reason than tidy
      // rows: the reuse branch below is what stops a trainee from re-rolling
      // the paper to enumerate the question bank. Read-then-write would let two
      // simultaneous taps on "start" each mint their own attempt — with
      // questions_per_attempt set that is N freshly sampled papers for free,
      // and the cooldown cannot catch it because it only counts SUBMITTED
      // failures. The progress row is the lock, and it is taken first here
      // exactly as in /opened, so the two endpoints cannot invert on each other.
      const outcome = await drizzle.transaction(async (tx: any) => {
        await tx
          .insert(passport_topic_progress)
          .values({ enrollment_id: enrollment.id, topic_id: topic.id, level: 0 })
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
              eq(passport_topic_progress.enrollment_id, enrollment.id),
              eq(passport_topic_progress.topic_id, topic.id)
            )
          )
          .for("update")
          .execute();

        // Re-checked under the lock, not just in the pre-flight above: a submit
        // that passed while this request was in flight has to win.
        if (row.level >= 2) return { passed_already: row.level as number };

        // A reload of the miniapp must not re-roll the paper or restart the
        // clock: an attempt already in flight for THIS topic is re-served.
        if (row.quiz_attempt_id) {
          const [live] = await tx
            .select()
            .from(attestation_test_attempts)
            .where(eq(attestation_test_attempts.id, row.quiz_attempt_id))
            .execute();
          if (live && live.status === "in_progress" && live.test_id === test.id) {
            return {
              id: live.id as string,
              started_at: live.started_at as string,
              question_ids: live.question_ids as string[],
            };
          }
        }

        const [attempt] = await tx
          .insert(attestation_test_attempts)
          .values({
            test_id: test.id,
            employee_id: guard.employee_id,
            // Server-derived, never client-supplied.
            terminal_id: enrollment.terminal_id,
            // No manager launches a miniapp attempt. The column is nullable
            // since migration 0016 (and carries no FK), so the row records
            // "nobody" honestly instead of an all-zero sentinel. `source` is
            // what actually distinguishes these rows.
            launched_by_user_id: null,
            status: "in_progress",
            question_ids: candidateIds,
            source: "miniapp",
          })
          .returning({
            id: attestation_test_attempts.id,
            started_at: attestation_test_attempts.started_at,
          })
          .execute();

        // The progress row is what binds an attempt to (enrollment, topic) —
        // attestation attempts know nothing about the passport. Submit
        // re-checks this link, so it is also the anti-tamper anchor.
        await tx
          .update(passport_topic_progress)
          .set({ quiz_attempt_id: attempt.id, updated_at: sql`now()` })
          .where(eq(passport_topic_progress.id, row.id))
          .execute();

        return {
          id: attempt.id as string,
          started_at: attempt.started_at as string,
          question_ids: candidateIds,
        };
      });

      if ("passed_already" in outcome) {
        set.status = 409;
        return { error: "already_passed", level: outcome.passed_already };
      }
      const attemptId: string = outcome.id;
      const startedAt: string = outcome.started_at;
      const orderedIds: string[] = outcome.question_ids;
      const options = await drizzle
        .select()
        .from(attestation_test_question_options)
        .where(
          inArray(attestation_test_question_options.question_id, orderedIds)
        )
        .execute();
      const qById = new Map(questions.map((q: any) => [q.id, q]));

      return {
        attempt_id: attemptId,
        started_at: startedAt,
        time_limit_minutes: test.time_limit_minutes,
        passing_score: test.passing_score,
        questions: orderedIds
          .filter((qid) => qById.has(qid))
          .map((qid) => {
            const q: any = qById.get(qid);
            const opts = options
              .filter((o: any) => o.question_id === qid)
              // NO is_correct ever leaves the server.
              .map((o: any) => ({ id: o.id, text: o.text }));
            return {
              id: q.id,
              text: q.text,
              type: q.type,
              options: test.shuffle_options ? shuffleWithRng(opts, rng) : opts,
            };
          }),
      };
    },
    { params: t.Object({ topicId: t.String({ format: "uuid" }) }) }
  )
  // ---- quiz submit ----
  .post(
    "/passport/tg/quiz/:topicId/submit",
    async ({ tgSession, params: { topicId }, body, drizzle, redis, headers, server, request, set }) => {
      const guard = traineeOrForbidden(tgSession, set);
      if (!guard) return { error: "forbidden" };

      const enrollment = await loadTraineeEnrollment(drizzle, guard.employee_id);
      if (!enrollment) {
        set.status = 404;
        return { error: "no_enrollment" };
      }
      const topic = await loadTopicInEnrollment(
        drizzle,
        topicId,
        enrollment.program_id
      );
      if (!topic) {
        set.status = 404;
        return { error: "topic_not_found" };
      }

      const [progress] = await drizzle
        .select()
        .from(passport_topic_progress)
        .where(
          and(
            eq(passport_topic_progress.enrollment_id, enrollment.id),
            eq(passport_topic_progress.topic_id, topic.id)
          )
        )
        .execute();

      // Four independent locks on the attempt, all server-side: it must be the
      // one THIS enrollment started for THIS topic, it must belong to this
      // employee, it must be this topic's test, and it must still be open.
      // Any one of them failing means the phone is asking for somebody else's
      // paper (or a replay of its own).
      if (!progress || progress.quiz_attempt_id !== body.attempt_id) {
        set.status = 404;
        return { error: "attempt_not_found" };
      }
      const [attempt] = await drizzle
        .select()
        .from(attestation_test_attempts)
        .where(eq(attestation_test_attempts.id, body.attempt_id))
        .execute();
      if (
        !attempt ||
        attempt.employee_id !== guard.employee_id ||
        attempt.test_id !== topic.quiz_test_id
      ) {
        set.status = 404;
        return { error: "attempt_not_found" };
      }
      if (attempt.status !== "in_progress") {
        set.status = 409;
        return { error: "attempt_already_finalized" };
      }

      const [test] = await drizzle
        .select()
        .from(attestation_tests)
        .where(eq(attestation_tests.id, attempt.test_id))
        .execute();

      const nowMs = Date.now();
      const startedMs = parseTimestamp(attempt.started_at);
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
        .where(
          inArray(attestation_test_question_options.question_id, questionIds)
        )
        .execute();

      const gradable: GradableQuestion[] = questions.map((q: any) => ({
        id: q.id,
        type: q.type as "single" | "multi",
        correctOptionIds: options
          .filter((o: any) => o.question_id === q.id && o.is_correct)
          .map((o: any) => o.id),
      }));

      // Score comes from the engine over the server's own question set; the
      // body only ever contributes selections.
      const answerMap: Record<string, string[]> = {};
      for (const a of body.answers) answerMap[a.question_id] = a.selected_option_ids;
      const { score } = gradeAttempt(gradable, answerMap);
      const passed = !overTime && score >= test.passing_score;
      const nowIso = new Date().toISOString();
      const expires_at =
        passed && test.valid_months != null
          ? new Date(nowMs + test.valid_months * 30 * 86400_000).toISOString()
          : null;

      const qTextById = new Map(questions.map((q: any) => [q.id, q.text]));
      const gradableById = new Map(gradable.map((g) => [g.id, g]));
      const snapshotRows = questionIds
        .filter((qid) => gradableById.has(qid))
        .map((qid) => {
          const selected = answerMap[qid] ?? [];
          const g = gradableById.get(qid)!;
          return {
            attempt_id: attempt.id,
            question_id: qid,
            question_text: (qTextById.get(qid) as string) ?? "",
            selected_option_ids: selected,
            is_correct:
              selected.length > 0 &&
              selected.length === g.correctOptionIds.length &&
              selected.every((s) => g.correctOptionIds.includes(s)),
          };
        });

      const ip = clientIp(server, request, headers);
      // Submit is the one endpoint that has to survive being sent TWICE — a
      // flaky mobile network or a double-tap makes the miniapp retry, and this
      // is not an adversarial scenario, it is Tuesday. Before the guard below,
      // both copies passed the status check (read outside any transaction) and
      // both committed: two journal rows, two full sets of answer snapshots
      // (attempt_answers has only a PK on id — nothing stops duplicates), and
      // two redis.incr calls, turning ONE failed quiz into an instant hour-long
      // lockout.
      //
      // So: lock the progress row FOR UPDATE first (same lock order as /opened
      // and /quiz/start, so the three cannot invert on each other), then make
      // the attempt UPDATE CONDITIONAL on it still being in_progress. Exactly
      // one caller gets a RETURNING row; the loser writes nothing, journals
      // nothing, and never touches Redis.
      const outcome = await drizzle.transaction(async (tx: any) => {
        const [locked] = await tx
          .select()
          .from(passport_topic_progress)
          .where(eq(passport_topic_progress.id, progress.id))
          .for("update")
          .execute();

        // Re-checked under the lock: a concurrent /quiz/start could have
        // repointed the link between the pre-flight read and here.
        if (!locked || locked.quiz_attempt_id !== attempt.id) {
          return { raced: true as const };
        }

        const claimed = await tx
          .update(attestation_test_attempts)
          .set({
            status: overTime ? "expired" : "submitted",
            submitted_at: nowIso,
            score,
            passed,
            expires_at,
          })
          .where(
            and(
              eq(attestation_test_attempts.id, attempt.id),
              eq(attestation_test_attempts.status, "in_progress")
            )
          )
          .returning({ id: attestation_test_attempts.id })
          .execute();
        // Somebody else finalised it first. Everything below is skipped.
        if (!claimed.length) return { raced: true as const };

        if (snapshotRows.length) {
          await tx
            .insert(attestation_test_attempt_answers)
            .values(snapshotRows)
            .execute();
        }

        // The level is derived from the value read UNDER the lock, never from
        // the unlocked pre-flight read. state.ts only ever moves levels up
        // (Math.max), but writing an absolute number computed from a stale read
        // would still undo a concurrent raise — once mentor sign-off can move a
        // topic to 3, a passing submit would have knocked it back to 2.
        let nextLevel: number = locked.level;
        if (passed) {
          nextLevel = levelAfterQuizPassed(
            locked.level,
            topic.verification_type as VerificationType
          );
          if (nextLevel !== locked.level) {
            await tx
              .update(passport_topic_progress)
              .set({ level: nextLevel, updated_at: sql`now()` })
              .where(eq(passport_topic_progress.id, locked.id))
              .execute();
          }
        }

        await tx
          .insert(passport_signoffs)
          .values({
            enrollment_id: enrollment.id,
            topic_id: topic.id,
            module_id: topic.module_id,
            action: passed ? "quiz_passed" : "quiz_failed",
            actor_employee_id: guard.employee_id,
            terminal_id: enrollment.terminal_id,
            ip,
            meta: {
              source: "miniapp",
              attempt_id: attempt.id,
              score,
              expired: overTime,
            },
          })
          .execute();

        return { raced: false as const, level: nextLevel };
      });

      if (outcome.raced) {
        set.status = 409;
        return { error: "attempt_already_finalized" };
      }
      const level = outcome.level;

      // Only the winner moves the counter, for the same reason it is the only
      // one that journals: a retried submit must cost the trainee one failure,
      // not two.
      const cdKey = quizCooldownKey(enrollment.id, topic.id);
      if (passed) {
        await redis.del(cdKey);
      } else {
        await redis.incr(cdKey);
        await redis.expire(cdKey, QUIZ_COOLDOWN_SEC);
      }

      return { attempt_id: attempt.id, score, passed, expired: overTime, level };
    },
    {
      params: t.Object({ topicId: t.String({ format: "uuid" }) }),
      body: t.Object({
        attempt_id: t.String({ format: "uuid" }),
        answers: t.Array(
          t.Object({
            question_id: t.String({ format: "uuid" }),
            selected_option_ids: t.Array(t.String({ format: "uuid" })),
          })
        ),
      }),
    }
  );

// Widened export, same reason as creditAdminController: keeps the app root
// .use() chain from overflowing TS instantiation depth.
export const passportTgController = passportTgControllerImpl as unknown as Elysia;
