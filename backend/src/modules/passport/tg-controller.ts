import { ctx } from "@backend/context";
import {
  passport_enrollments,
  passport_invites,
  passport_tg_bindings,
} from "backend/drizzle/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { randomUUID } from "crypto";
import { parseInviteStartParam, verifyInitData } from "./tg-auth";
import {
  PASSPORT_TG_SESSION_TTL_SEC,
  passportTgSessionKey,
  type PassportTgSession,
} from "./tg-ctx";

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
  );

// Widened export, same reason as creditAdminController: keeps the app root
// .use() chain from overflowing TS instantiation depth.
export const passportTgController = passportTgControllerImpl as unknown as Elysia;
