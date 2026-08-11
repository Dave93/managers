"use client";

// The QR payload, and the one place that knows the bot exists.
//
// An invite id becomes a scannable thing only as
//   https://t.me/<bot>?startapp=inv_<invite_id>
// (tg-auth.ts:86-91 — the miniapp reads `start_param` and requires the
// `inv_` prefix + a well-formed uuid).
//
// The bot is `@pasport_stajer_bot`, and it is NOT hardcoded here: the username
// comes from `NEXT_PUBLIC_PASSPORT_BOT` (already set in admin/.env). A QR
// pointing at the wrong bot fails silently, hours later, in the hands of a
// trainee who has no idea what went wrong, so when that variable is unset this
// module reports "not configured" and the print view refuses to print rather
// than guessing. Creating the enrollment still works — only the paper artifact
// is withheld.
//
// NEXT_PUBLIC_* is inlined by Next at BUILD time, not read at runtime: setting
// it after the fact does nothing until `bun run build` runs again. The value
// landed in admin/.env AFTER the build that shipped this file, so the deploy
// task MUST rebuild the admin or printing stays disabled at runtime.

export const BOT_ENV_VAR = "NEXT_PUBLIC_PASSPORT_BOT";

/** The @username of the passport bot, without the "@", or null if unset. */
export function botUsername(): string | null {
  // Written as a literal member access on purpose — Next only inlines this
  // form; `process.env[name]` would compile to an undefined lookup.
  const raw = process.env.NEXT_PUBLIC_PASSPORT_BOT;
  const v = (raw ?? "").trim().replace(/^@/, "");
  return v.length ? v : null;
}

/** The deep link a trainee's QR encodes, or null while the bot is unset. */
export function inviteUrl(inviteId: string): string | null {
  const bot = botUsername();
  if (!bot) return null;
  return `https://t.me/${bot}?startapp=inv_${inviteId}`;
}
