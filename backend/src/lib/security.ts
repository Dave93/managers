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
 * Ошибка базы (drizzle/postgres): её текст содержит SQL и параметры запроса — наружу его не отдаём.
 * Остальные ошибки модулей не трогаем: старые экраны показывают их текст пользователю.
 */
export function isDbError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "DrizzleQueryError" || e.message.startsWith("Failed query:")) return true;
  const cause = (e as { cause?: unknown }).cause;
  return e.name === "PostgresError" || (cause instanceof Error && cause.name === "PostgresError");
}

/** После стольких неверных паролей подряд вход по этому логину закрывается на LOGIN_LOCK_SECONDS. */
export const LOGIN_MAX_FAILS = 10;
export const LOGIN_LOCK_SECONDS = 15 * 60;

type RedisLike = {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

// По логину, а не по IP: вход из админки идёт через её прокси, и бэкенд видит 127.0.0.1 у всех.
const failKey = (login: string) => `${process.env.PROJECT_PREFIX}login_fail:${login.trim().toLowerCase()}`;

export async function loginLocked(redis: RedisLike, login: string): Promise<boolean> {
  return Number((await redis.get(failKey(login))) ?? 0) >= LOGIN_MAX_FAILS;
}

/** Считает неверный пароль; окно отсчитывается от первой ошибки. */
export async function loginFailed(redis: RedisLike, login: string): Promise<void> {
  const n = await redis.incr(failKey(login));
  if (n === 1) await redis.expire(failKey(login), LOGIN_LOCK_SECONDS);
}

export async function loginSucceeded(redis: RedisLike, login: string): Promise<void> {
  await redis.del(failKey(login));
}
