import { ctx } from "@backend/context";
import Elysia from "elysia";

// Shape stored in Redis under `${PROJECT_PREFIX}passport_tg_session:<token>`.
// One of employee_id (trainee) / user_id (mentor) is always set.
export type PassportTgSession = {
  binding_id: string;
  employee_id: string | null;
  user_id: string | null;
  telegram_id: number;
  role: "trainee" | "mentor";
  lang: string;
};

export const PASSPORT_TG_SESSION_TTL_SEC = 12 * 60 * 60;

export function passportTgSessionKey(token: string): string {
  return `${process.env.PROJECT_PREFIX}passport_tg_session:${token}`;
}

// Auth guard for the miniapp's trainee/mentor endpoints (consumed by Task 8).
//
// Deliberately `.as("scoped")`, not `.as("global")`: scoped propagates the
// derive exactly one level up — to the controller instance that `.use()`s this
// plugin — which is all Task 8 needs. "global" would keep propagating past that
// controller into the app root and put a Bearer-token requirement on unrelated
// routes, including POST /passport/tg/auth itself, which must stay public.
export const passportTgCtx = new Elysia({
  name: "@app/passport_tg_ctx",
})
  .use(ctx)
  .derive(async ({ redis, headers, status }) => {
    const token = headers["authorization"]?.split(" ")[1];
    // No token logging anywhere in this file: the bearer token IS the session.
    if (!token) return status(401, { error: "unauthorized" });
    let raw: string | null = null;
    try {
      raw = await redis.get(passportTgSessionKey(token));
    } catch {
      return status(401, { error: "unauthorized" });
    }
    if (!raw) return status(401, { error: "unauthorized" });
    let session: PassportTgSession;
    try {
      session = JSON.parse(raw) as PassportTgSession;
    } catch {
      return status(401, { error: "unauthorized" });
    }
    return { tgSession: session };
  })
  .as("scoped");
