import { randomUUID } from "node:crypto";
import Redis from "ioredis";

// Тесты уровня HTTP гоняют настоящий app.handle() поверх ОТДЕЛЬНОЙ базы и
// ИЗОЛИРОВАННОГО redis-неймспейса. Обе переменные (DATABASE_URL,
// PROJECT_PREFIX) выставляются здесь, до первого импорта src/app — иначе
// синглтоны (drizzle-пул в lib/db.ts, CacheControlService в context/index.ts)
// успеют схватить продовые process.env при первом обращении.
//
// ВАЖНО: этот файл обязан быть первым импортом в любом *.test.ts, который
// зовёт callApi/ensureApp. Любой статический `import app from "../../src/app"`
// в другом месте того же файла выполнится раньше этого модуля (import
// hoisting) и обойдёт изоляцию — см. tests/helpers/README.md.

function computeTestDbUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (base) return base.replace(/\/[^/]*$/, "/managers_tickets_test");
  return "postgres://postgres:postgres@localhost:5432/managers_tickets_test";
}

export const TEST_DB_URL = computeTestDbUrl();

// Fail closed: не даём этому файлу молча указать drizzle на что-то, кроме
// тестовой базы — ни на прод managers, ни на чужую managers_dev и т.п.
if (!TEST_DB_URL.endsWith("/managers_tickets_test")) {
  throw new Error(
    `tests/helpers/http.ts: TEST_DB_URL не заканчивается на /managers_tickets_test (получили "${TEST_DB_URL}"). Отказываюсь грузить модуль.`
  );
}

// Redis-неймспейс теста — НЕ продовый ${PROJECT_PREFIX} ("managers_").
// Импорт src/app тянет context/index.ts, который на своём module-scope
// конструирует CacheControlService; её конструктор без ожидания шлёт ~15
// SET'ов (cacheRoles, cachePermissions, cacheTerminals, cacheUsers, ...),
// читая данные из базы, на которую СЕЙЧАС указывает DATABASE_URL (то есть
// из пустой managers_tickets_test). Если не подменить PROJECT_PREFIX, эти
// SET'ы затрут продовые ключи managers__roles, managers_permissions и т.д.
// живыми пустыми данными сразу же при первом callApi(). Поэтому подменяем
// префикс для всего процесса: весь `bun test` под этим файлом живёт в
// неймспейсе managers_test_.
const TEST_PREFIX = process.env.TEST_PROJECT_PREFIX ?? "managers_test_";

process.env.DATABASE_URL = TEST_DB_URL;
process.env.PROJECT_PREFIX = TEST_PREFIX;

const prefix = TEST_PREFIX;

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: parseInt(process.env.REDIS_PORT ?? "6379"),
});

export type SessionOptions = {
  permissions: string[];
  terminals?: string[];
  userId?: string;
  roleId?: string;
};

// Настоящий ключ из backend/src/modules/cache_control/service.ts::cacheRoles()
// — `${PROJECT_PREFIX}_roles` (с подчёркиванием между префиксом и "roles"),
// а НЕ `${PROJECT_PREFIX}roles`. Проверено по коду и по прод-redis
// (`redis-cli --scan --pattern 'managers_*roles*'` вернул `managers__roles`).
const rolesKey = `${prefix}_roles`;
// Отличительный код фейковой роли — по нему sweepTestRoles() чистит
// ${rolesKey} даже если конкретный roleId потерян (упавший тест).
const TEST_ROLE_CODE = "__http_test__";

// Макрос permission (backend/src/context/index.ts) читает две вещи:
// user_data:<sessionId> (юзер, роль, терминалы) и кэш ролей, откуда берёт
// права по role.id (cacheController.getPermissionsByRoleId -> getCachedRoles).
// Тест подкладывает обе, потому что поднимать настоящий логин ради проверки
// доступа — это проверять логин, а не доступ.
export async function withSession(opts: SessionOptions) {
  // ensureApp() (см. ниже) в первый раз, когда её кто-то вызовет, импортирует
  // src/app и ждёт, пока осядет неawait-нутый cacheRoles() из конструктора
  // CacheControlService — тот запрос читает пустую тестовую базу и пишет
  // пустой массив в ${rolesKey}. Если withSession() положит фейковую роль
  // РАНЬШЕ этого оседания, конструктор её затрёт. Поэтому withSession() сама
  // дожидается ensureApp() первой строкой — вызывающему коду не нужно помнить
  // порядок, а повторный вызов ensureApp() после первого — это no-op
  // (appPromise закэширован).
  await ensureApp();

  const sessionId = randomUUID();
  const userId = opts.userId ?? randomUUID();
  const roleId = opts.roleId ?? randomUUID();

  await redis.set(
    `${prefix}user_data:${sessionId}`,
    JSON.stringify({
      user: { id: userId, status: "active", login: `test_${userId.slice(0, 8)}` },
      role: { id: roleId, name: "test", code: TEST_ROLE_CODE },
      terminals: opts.terminals ?? [],
    }),
    "EX",
    300
  );

  const existing = await redis.get(rolesKey);
  const roles = existing ? JSON.parse(existing) : [];
  roles.push({
    id: roleId,
    name: "test",
    code: TEST_ROLE_CODE,
    active: true,
    permissions: opts.permissions,
  });
  await redis.set(rolesKey, JSON.stringify(roles));

  return {
    sessionId,
    userId,
    roleId,
    headers: { cookie: `sessionId=${sessionId}` },
    async cleanup() {
      await redis.del(`${prefix}user_data:${sessionId}`);
      const raw = await redis.get(rolesKey);
      if (raw) {
        const list = JSON.parse(raw).filter((r: any) => r.id !== roleId);
        await redis.set(rolesKey, JSON.stringify(list));
      }
    },
  };
}

// Страховка сверх withSession(...).cleanup(): если тест упал до cleanup(),
// в ${rolesKey} остаётся мусорная роль. sweepTestRoles() выметает все роли
// с TEST_ROLE_CODE разом — вызывать из afterAll набора.
export async function sweepTestRoles() {
  const raw = await redis.get(rolesKey);
  if (!raw) return;
  const list = JSON.parse(raw).filter((r: any) => r.code !== TEST_ROLE_CODE);
  await redis.set(rolesKey, JSON.stringify(list));
}

// Весь неймспейс managers_test_* одноразовый по определению — если
// предыдущий прогон упал до cleanup()/sweepTestRoles(), тут могут остаться
// мусорная роль, протухшая сессия (у неё есть EX 300, но это до 5 минут) и
// пустые cache_control-ключи. Сносим всё под этим префиксом перед КАЖДЫМ
// новым процессом (ensureApp() кэширует promise, так что это выполняется
// ровно один раз за bun test), а не полагаемся на TTL/self-heal по частям.
async function wipeTestNamespace() {
  const stream = redis.scanStream({ match: `${prefix}*`, count: 500 });
  const keys: string[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<string[]>) {
    keys.push(...chunk);
  }
  if (keys.length) await redis.del(...keys);
}

let appPromise: Promise<any> | null = null;

// Ленивый импорт src/app. Вызывать только после того, как этот модуль уже
// выполнился (то есть DATABASE_URL/PROJECT_PREFIX уже подменены). Сначала
// сносит весь ${prefix}* неймспейс (см. wipeTestNamespace), затем импортирует
// app и повторно ждёт cacheRoles(), чтобы погасить гонку с конструктором
// CacheControlService: его собственный неawait-нутый cacheRoles() может
// дописаться в ${rolesKey} уже ПОСЛЕ того, как withSession() туда что-то
// положил, и затереть фейковую роль пустым массивом (пустая тестовая база).
export async function ensureApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await wipeTestNamespace();
      const [{ default: app }, { getCacheControlService }] = await Promise.all([
        import("../../src/app"),
        import("../../src/lib/shared-instances"),
      ]);
      await getCacheControlService().cacheRoles();
      return app;
    })();
  }
  return appPromise;
}

export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const app = await ensureApp();
  return app.handle(new Request(`http://localhost${path}`, init));
}

export async function closeTestRedis() {
  await redis.quit();
}
