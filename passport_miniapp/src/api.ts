// The whole conversation with the backend: one auth exchange, one guarded
// fetch wrapper. Contract read from backend/src/modules/passport/tg-controller.ts
// and tg-ctx.ts, not guessed.
//
//   POST /api/passport/tg/auth  {init_data}
//     200 {token, expires_at, role: "trainee"|"mentor", lang}
//     401 {error:"bad_init_data"}      bad signature OR auth_date older than 24h
//     403 {error:"no_access"|"banned"|"wrong_account"}
//     503 {error:"not_configured"}     PASSPORT_BOT_TOKEN missing on the server
//
//   every other /api/passport/tg/* route: Authorization: Bearer <token>,
//     401 {error:"unauthorized"} when the Redis session is gone (12h TTL).
import { initData } from "./telegram";
import type { StatusKey } from "./i18n";
import { setLang, isLang } from "./i18n";

const BASE = "/api/passport/tg";

// Leading slash on purpose: vite's base is "/passport-app/", so a relative
// path would resolve to /passport-app/api/... and 404.
function url(path: string): string {
  return BASE + path;
}

// Branch wifi does not fail, it hangs. Without this the app would sit on the
// loading skeleton forever with nothing to say, which is the one behaviour the
// brief forbids. 15s is long enough for a cold backend, short enough that a
// cook does not give up first.
const TIMEOUT_MS = 15_000;

export type Role = "trainee" | "mentor";

/** Module-level, never localStorage: the bearer token IS the session. */
let token: string | null = null;
let role: Role | null = null;

export function currentRole(): Role | null {
  return role;
}

export type AuthResult =
  | { kind: "ok"; role: Role }
  | { kind: "fail"; status: StatusKey };

type Json = Record<string, unknown>;

async function request(
  path: string,
  init: RequestInit
): Promise<{ res: Response; body: Json | null } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url(path), { ...init, signal: ctrl.signal });
    let body: Json | null = null;
    try {
      body = (await res.json()) as Json;
    } catch {
      // A 502 from nginx is HTML, not JSON. Not fatal: the status still
      // classifies the failure.
      body = null;
    }
    return { res, body };
  } catch {
    // Network down, DNS gone, timeout fired.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function errorOf(body: Json | null): string | null {
  const e = body?.["error"];
  return typeof e === "string" ? e : null;
}

/**
 * Exchange initData for a session token.
 *
 * Posts `Telegram.WebApp.initData` untouched. That string is captured by the
 * client when the miniapp launches and is NOT regenerated afterwards, which is
 * exactly why re-authentication works at all (auth_date stays valid for 24h)
 * and also why it cannot save a session that Telegram itself has expired --
 * see the `expired` copy, which tells the user to reopen rather than retry.
 */
export async function authenticate(): Promise<AuthResult> {
  const init_data = initData();
  // Empty means: opened outside Telegram, or telegram-web-app.js never loaded.
  // Posting "" would come back 401 bad_init_data and be rendered as a denial,
  // sending someone to IT over a page they simply opened in Chrome.
  if (!init_data) return { kind: "fail", status: "outside_telegram" };

  const out = await request("/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init_data }),
  });
  if (!out) return { kind: "fail", status: "offline" };

  const { res, body } = out;
  if (res.ok) {
    const tk = body?.["token"];
    const rl = body?.["role"];
    if (typeof tk !== "string" || (rl !== "trainee" && rl !== "mentor")) {
      return { kind: "fail", status: "unknown" };
    }
    token = tk;
    role = rl;
    const serverLang = body?.["lang"];
    // Server seed only. A choice this phone has already made wins -- setLang
    // enforces that -- because no route exists to push the choice back.
    if (isLang(serverLang)) setLang(serverLang, false);
    return { kind: "ok", role: rl };
  }

  // The status code alone is not enough: 403 carries three different human
  // situations and they need three different screens.
  const err = errorOf(body);
  if (res.status === 403) {
    if (err === "banned") return { kind: "fail", status: "banned" };
    if (err === "wrong_account") return { kind: "fail", status: "wrong_account" };
    return { kind: "fail", status: "no_access" };
  }
  if (res.status === 401) return { kind: "fail", status: "expired" };
  if (res.status === 503) return { kind: "fail", status: "not_configured" };
  if (res.status >= 500) return { kind: "fail", status: "offline" };
  return { kind: "fail", status: "unknown" };
}

export type ApiResult<T> =
  /** 2xx with a parsed body. */
  | { kind: "ok"; data: T }
  /** Terminal: render this status screen. */
  | { kind: "fail"; status: StatusKey }
  /** Non-2xx the caller is expected to interpret (404 no_enrollment, 429 …). */
  | { kind: "http"; code: number; error: string | null };

/**
 * Authenticated call with ONE re-authentication on 401.
 *
 * The session lives 12h in Redis while initData stays valid for 24h, so a
 * trainee who leaves the app open across the boundary gets a silent recovery
 * instead of a dead end. `retried` makes it strictly once: if the second
 * attempt also 401s, something is genuinely wrong and looping would just spin
 * the phone's radio.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<ApiResult<T>> {
  if (!token) {
    const auth = await authenticate();
    if (auth.kind === "fail") return { kind: "fail", status: auth.status };
  }

  // Headers via the Headers constructor, NOT an object spread.
  //
  // `{ ...init.headers }` only works when the caller passed a plain object. A
  // `Headers` instance or a `[k, v][]` -- both legal RequestInit.headers, and
  // both natural for the POSTs C3 is about to add -- spread to nothing, which
  // would silently DROP the Authorization header. The request would come back
  // 401 and be rendered as an expired session: a bug that looks like a login
  // problem and would be debugged in the wrong place entirely. The constructor
  // accepts all three forms.
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  const out = await request(path, { ...init, headers });
  if (!out) return { kind: "fail", status: "offline" };

  const { res, body } = out;
  if (res.ok) {
    // `body` is null when the response carried no JSON (an empty 204, or an
    // HTML error page from nginx that still arrived with a 2xx). Casting that
    // to T would hand the caller a null it has been promised is a T; parseMe
    // guards today, but this stops the lie at the boundary instead of relying
    // on every future caller to re-check.
    if (body === null) return { kind: "fail", status: "unknown" };
    return { kind: "ok", data: body as T };
  }

  if (res.status === 401 && !retried) {
    token = null;
    const auth = await authenticate();
    if (auth.kind === "fail") return { kind: "fail", status: auth.status };
    return api<T>(path, init, true);
  }
  if (res.status === 401) return { kind: "fail", status: "expired" };
  if (res.status >= 500) return { kind: "fail", status: "offline" };
  return { kind: "http", code: res.status, error: errorOf(body) };
}
