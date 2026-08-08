import { createHmac, timingSafeEqual } from "crypto";

// Telegram Web Apps initData verification.
//
// This function is the entire security boundary of the trainee miniapp: the
// phone sends us a signed blob, and everything downstream ("this request is
// telegram user 42") rests on this check. Algorithm per Telegram docs:
//
//   secret = HMAC_SHA256(key="WebAppData", message=botToken)
//   expected = HMAC_SHA256(key=secret, message=dataCheckString)
//
// where dataCheckString is every field EXCEPT `hash`, sorted by key, joined
// with "\n" as "k=v" (values are the URL-DECODED ones, which is what
// URLSearchParams hands back).
//
// `nowSec` is a parameter rather than Date.now() so the 24h staleness rule is
// deterministically testable.
export type VerifyInitDataResult =
  | { ok: true; telegramId: number; firstName: string; startParam: string | null }
  | { ok: false; error: string };

export const INIT_DATA_MAX_AGE_SEC = 86_400;

export function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number
): VerifyInitDataResult {
  // Fail closed: an empty bot token would still produce a well-formed HMAC,
  // so anyone who guessed "" as the key could mint valid initData.
  if (!botToken) return { ok: false as const, error: "no_bot_token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false as const, error: "no_hash" };
  params.delete("hash");

  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");

  // timingSafeEqual THROWS on a length mismatch, so the length guard is load
  // bearing, not decorative: a short `hash` would otherwise crash the handler.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false as const, error: "bad_hash" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || !authDate) {
    return { ok: false as const, error: "no_auth_date" };
  }
  if (nowSec - authDate > INIT_DATA_MAX_AGE_SEC) {
    return { ok: false as const, error: "stale" };
  }

  let telegramId = 0;
  let firstName = "";
  try {
    const u = JSON.parse(params.get("user") ?? "{}");
    telegramId = Number(u?.id ?? 0);
    firstName = String(u?.first_name ?? "");
  } catch {
    return { ok: false as const, error: "bad_user" };
  }
  if (!telegramId || !Number.isFinite(telegramId)) {
    return { ok: false as const, error: "no_user" };
  }

  return {
    ok: true as const,
    telegramId,
    firstName,
    startParam: params.get("start_param"),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// start_param arrives as `inv_<uuid>`. passport_invites.id is a Postgres uuid
// column, so a malformed value must be rejected here — handing "inv_notauuid"
// to the query turns a 403 into a 500.
export function parseInviteStartParam(startParam: string | null): string | null {
  if (!startParam) return null;
  if (!startParam.startsWith("inv_")) return null;
  const id = startParam.slice(4);
  return UUID_RE.test(id) ? id : null;
}
