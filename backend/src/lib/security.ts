// Защита API, общая для всех модулей: кому разрешён CORS, что отдавать наружу при
// ошибке и сколько неверных паролей подряд допускает вход.

/**
 * Сайты, которым браузер разрешит читать ответы API с куками. Куки сессии выдаются на весь
 * lesailes.uz, поэтому «любой Origin» означал бы, что любой поддомен читает данные от имени
 * вошедшего пользователя. Админка ходит в API через свой /api (тот же origin), CORS ей не нужен.
 * Дополнительные сайты — через CORS_ORIGINS (через запятую), без пересборки.
 */
export function corsOrigins(env: Record<string, string | undefined> = process.env): (string | RegExp)[] {
  const extra = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const base: (string | RegExp)[] = ["https://office.lesailes.uz", "https://api.office.lesailes.uz"];
  if (env.ENV === "development") base.push(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
  return [...base, ...extra];
}

/**
 * Ошибка базы (drizzle/pg): её текст содержит SQL и параметры запроса — наружу его не отдаём.
 * drizzle 0.44 оборачивает ошибку драйвера в DrizzleQueryError («Failed query: …»), а сама
 * ошибка pg (DatabaseError) — name "error", зато у неё есть severity и пятисимвольный SQLSTATE.
 * Остальные ошибки модулей не трогаем: старые экраны показывают их текст пользователю.
 */
export function isDbError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "DrizzleQueryError" || e.message.startsWith("Failed query:")) return true;
  const cause = (e as { cause?: unknown }).cause;
  return isPgError(e) || (cause instanceof Error && isPgError(cause));
}

function isPgError(e: Error): boolean {
  const { severity, code } = e as { severity?: unknown; code?: unknown };
  return typeof severity === "string" && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
}

/** Текст ошибки для ответа клиенту из локального catch: ошибку базы прячем, остальные — как были. */
export function publicMessage(e: unknown): string {
  if (isDbError(e)) {
    console.error("[db error]", e);
    return "Internal server error";
  }
  return e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? "Unknown error";
}

/** Столько попыток входа по одному логину за окно LOGIN_LOCK_SECONDS; удачный вход окно сбрасывает. */
export const LOGIN_MAX_FAILS = 10;
export const LOGIN_LOCK_SECONDS = 15 * 60;

type RedisLike = {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

// По логину, а не по IP: вход идёт браузер → office (Next rewrite) → api.office, и бэкенд видит
// в X-Real-IP адрес самого сервера у всех. Цена: кто знает логин, может закрыть его на окно
// LOGIN_LOCK_SECONDS (11 неверных паролей). Снять блокировку вручную: DEL <PROJECT_PREFIX>login_fail:<логин>.
const failKey = (login: string) => `${process.env.PROJECT_PREFIX}login_fail:${login.trim().toLowerCase()}`;

// INCR и срок одной командой: раздельные SET NX + INCR между собой могли пережить истечение ключа,
// и INCR создавал счётчик без срока — вечную блокировку. TTL -1 чинит и такие ключи, оставшиеся с прошлых версий.
const ATTEMPT_LUA = `
local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/**
 * Засчитывает попытку ДО проверки пароля и говорит, можно ли проверять. Сначала счётчик, потом
 * пароль: иначе пачка параллельных запросов успевает пройти проверку, пока никто не увеличил счётчик.
 * Redis недоступен — пропускаем (fail-open, с записью в журнал): без Redis вход всё равно не создаст
 * сессию, а лимит не должен сам становиться причиной отказа.
 */
export async function loginAttempt(redis: RedisLike, login: string): Promise<boolean> {
  try {
    const n = Number(await redis.eval(ATTEMPT_LUA, 1, failKey(login), LOGIN_LOCK_SECONDS));
    return n <= LOGIN_MAX_FAILS;
  } catch (e) {
    console.error("[login limit] redis failed, allowing attempt:", (e as Error).message);
    return true;
  }
}

export async function loginSucceeded(redis: RedisLike, login: string): Promise<void> {
  try {
    await redis.del(failKey(login));
  } catch (e) {
    console.error("[login limit] redis failed on reset:", (e as Error).message);
  }
}
