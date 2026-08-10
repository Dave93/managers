"use client";

// The QR payload, and the one place that knows the bot exists.
//
// An invite id becomes a scannable thing only as
//   https://t.me/<bot>?startapp=inv_<invite_id>
// (tg-auth.ts:86-91 — the miniapp reads `start_param` and requires the
// `inv_` prefix + a well-formed uuid).
//
// !! THE BOT IS NOT PROVISIONED YET !!
// `PASSPORT_BOT_TOKEN` in backend/.env is a placeholder — Telegram's getMe
// answers 401 for it, so there is no username to hardcode and guessing one
// would be worse than useless: a QR pointing at the wrong bot fails silently,
// hours later, in the hands of a trainee who has no idea what went wrong.
// So the username comes from `NEXT_PUBLIC_PASSPORT_BOT` and, when that is
// unset, this module reports "not configured" and the print view refuses to
// print. Creating the enrollment still works — only the paper artifact is
// withheld.
//
// NEXT_PUBLIC_* is inlined by Next at BUILD time, not read at runtime: setting
// it after the fact does nothing until `bun run build` runs again. Whoever
// deploys must put it in admin/.env BEFORE building.

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
