import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll } from "bun:test";

// Тесты уровня HTTP гоняют настоящий app.handle() поверх ОТДЕЛЬНОЙ базы и
// ИЗОЛИРОВАННОГО redis-неймспейса. Раньше DATABASE_URL/PROJECT_PREFIX
// подменялись прямо здесь, в начале модуля — но это работает, только если
// данный файл гарантированно первый импорт во всём тестовом процессе.
// Статический import app from "../../src/app", случайно оказавшийся выше по
// файлу (import hoisting поднимает такие импорты вне зависимости от порядка
// строк), тихо обходил бы подмену — и именно такой обход привёл бы к порче
// продового redis-кэша (см. ниже). Поэтому изоляция больше НЕ зависит от
// порядка импортов: обе переменные обязаны быть выставлены СНАРУЖИ процесса,
// через bun run test:http (см. backend/package.json), а этот модуль на
// старте только проверяет их и падает с понятной ошибкой, если снаружи
// что-то не так — при любом порядке импортов в тестовом файле.

const EXPECTED_PREFIX = "managers_test_";

export const TEST_DB_URL = process.env.DATABASE_URL ?? "";

if (!TEST_DB_URL.endsWith("/managers_tickets_test")) {
  throw new Error(
    "tests/helpers/http.ts: DATABASE_URL не указывает на managers_tickets_test " +
      "(получили " + JSON.stringify(TEST_DB_URL) + "). Гоняйте тесты через " +
      "bun run test:http (см. backend/package.json) — он выставляет " +
      "DATABASE_URL до старта bun, а не полагается на этот модуль."
  );
}

// Импорт src/app тянет context/index.ts, который на своём module-scope
// конструирует CacheControlService; её конструктор без ожидания шлёт ~15
// SET'ов (cacheRoles, cachePermissions, cacheTerminals, cacheUsers, ...),
// читая данные из базы, на которую указывает DATABASE_URL (то есть из
// managers_tickets_test), и пишет их под текущим process.env.PROJECT_PREFIX.
// Если PROJECT_PREFIX не изолирован, эти SET'ы затрут продовые ключи
// (managers__roles, managers_permissions и т.д.) пустыми данными из тестовой
// базы при первом же callApi(). Тот же fail-fast, что и для DATABASE_URL.
if (process.env.PROJECT_PREFIX !== EXPECTED_PREFIX) {
  throw new Error(
    "tests/helpers/http.ts: PROJECT_PREFIX не равен " + JSON.stringify(EXPECTED_PREFIX) +
      " (получили " + JSON.stringify(process.env.PROJECT_PREFIX) + "). Гоняйте тесты через " +
      "bun run test:http — он выставляет переменную окружения до старта bun, " +
      "так что порядок импортов внутри тестового файла уже не важен."
  );
}

const prefix = EXPECTED_PREFIX;

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
// — PROJECT_PREFIX + "_roles" (с подчёркиванием между префиксом и "roles"),
// а НЕ PROJECT_PREFIX + "roles". Проверено по коду и по прод-redis
// (redis-cli --scan --pattern 'managers_*roles*' вернул managers__roles).
const rolesKey = prefix + "_roles";
// Отличительный код фейковой роли — по нему sweepTestRoles() чистит
// rolesKey даже если конкретный roleId потерян (упавший тест).
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
  // пустой массив в rolesKey. Если withSession() положит фейковую роль
  // РАНЬШЕ этого оседания, конструктор её затрёт. Поэтому withSession() сама
  // дожидается ensureApp() первой строкой — вызывающему коду не нужно помнить
  // порядок, а повторный вызов ensureApp() после первого — это no-op
  // (appPromise закэширован).
  await ensureApp();

  const sessionId = randomUUID();
  const userId = opts.userId ?? randomUUID();
  const roleId = opts.roleId ?? randomUUID();

  await redis.set(
    prefix + "user_data:" + sessionId,
    JSON.stringify({
      user: { id: userId, status: "active", login: "test_" + userId.slice(0, 8) },
      role: { id: roleId, name: "test", code: TEST_ROLE_CODE },
      terminals: opts.terminals ?? [],
    }),
    "EX",
    300
  );

  // Read-modify-write без блокировки: две параллельные withSession() в одном
  // тесте/файле могут потерять одну из фейковых ролей (классический lost
  // update). Не безопасно для конкурентных вызовов — см.
  // tests/helpers/README.md.
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
    headers: { cookie: "sessionId=" + sessionId },
    async cleanup() {
      await redis.del(prefix + "user_data:" + sessionId);
      const raw = await redis.get(rolesKey);
      if (raw) {
        const list = JSON.parse(raw).filter((r: any) => r.id !== roleId);
        await redis.set(rolesKey, JSON.stringify(list));
      }
    },
  };
}

// Страховка сверх withSession(...).cleanup(): если тест упал до cleanup(),
// в rolesKey остаётся мусорная роль. sweepTestRoles() выметает все роли с
// TEST_ROLE_CODE разом — вызывать из afterAll набора теста.
export async function sweepTestRoles() {
  const raw = await redis.get(rolesKey);
  if (!raw) return;
  const list = JSON.parse(raw).filter((r: any) => r.code !== TEST_ROLE_CODE);
  await redis.set(rolesKey, JSON.stringify(list));
}

// Полный снос всего неймспейса prefix* — не только ролей/сессий, но и
// cache_control-ключей (managers_test_terminals, managers_test_permissions,
// ...), которые CacheControlService пишет при импорте app. Внутренний
// примитив без дедупликации; используется и на старте (ensureApp), и на
// конце (teardownTestNamespace).
async function wipeTestNamespace(): Promise<void> {
  const stream = redis.scanStream({ match: prefix + "*", count: 500 });
  const keys: string[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<string[]>) {
    keys.push(...chunk);
  }
  if (keys.length) await redis.del(...keys);
}

// Экспортированный, идемпотентный снос "на конец прогона". Раньше уборка
// зависела от того, что кто-то СЛЕДУЮЩИЙ вызовет ensureApp() и подчистит за
// нами — то есть от будущего прогона, который мог не наступить. Это не
// уборка, а надежда. Теперь: closeTestRedis() зовёт её явно, а afterAll()
// ниже — страховка на случай, если тестовый файл забыл вызвать
// closeTestRedis() вовсе. Флаг teardownDone гарантирует, что повторный
// вызов (afterAll() ПОСЛЕ явного closeTestRedis(), или наоборот) не
// пересканирует redis повторно.
let teardownDone = false;
export async function teardownTestNamespace(): Promise<void> {
  if (teardownDone) return;
  teardownDone = true;
  await wipeTestNamespace();
}

// process.on("beforeExit") / process.on("exit") НЕ РАБОТАЮТ здесь — проверено
// эмпирически (повесил console.error на оба хендлера и прогнал smoke-тест
// без единого явного cleanup()/closeTestRedis(): ни один хендлер не
// напечатался, хотя процесс завершился с кодом 0 и managers_test_* остались
// висеть). Похоже, bun test завершает процесс жёстко сразу после прогона
// файла, не давая Node-стилю событий процесса произойти — вероятно, из-за
// открытых хендлов (наши же redis-подключения, плюс BullMQ Queue из
// iiko_sync/controllers.ts, который этот файл не может закрыть — см.
// tests/helpers/README.md и отчёт по задаче).
//
// Рабочий механизм — собственный afterAll() bun:test, вызванный на верхнем
// уровне модуля (не внутри describe): bun:test гарантированно зовёт такие
// хуки после ВСЕХ тестов файла, до печати итога прогона. Подтверждено тем же
// способом: managers_test_* пуст после прогона, даже если тестовый файл не
// вызвал ни cleanup(), ни closeTestRedis().
afterAll(async () => {
  await teardownTestNamespace();
});

let appPromise: Promise<any> | null = null;
let appRedisClient: Redis | null = null;

// Ленивый импорт src/app. Сначала сносит весь prefix* неймспейс (не через
// teardownTestNamespace() — та зарезервирована под конец ЭТОГО прогона;
// здесь нужен отдельный, не дедуплицированный проход на случай, если
// предыдущий процесс упал настолько резко, что даже afterAll() не успел
// отработать: SIGKILL, убитая машина). Затем импортирует app и повторно
// ждёт cacheRoles(), чтобы погасить гонку с конструктором CacheControlService:
// его собственный неawait-нутый cacheRoles() может дописаться в rolesKey уже
// ПОСЛЕ того, как withSession() туда что-то положил, и затереть фейковую
// роль пустым массивом (пустая тестовая база).
export async function ensureApp() {
  if (!appPromise) {
    appPromise = (async () => {
      await wipeTestNamespace();
      const [{ default: app }, { getCacheControlService, getRedisClient }] = await Promise.all([
        import("../../src/app"),
        import("../../src/lib/shared-instances"),
      ]);
      appRedisClient = getRedisClient();
      await getCacheControlService().cacheRoles();
      return app;
    })();
  }
  return appPromise;
}

export async function callApi(path: string, init?: RequestInit): Promise<Response> {
  const app = await ensureApp();
  return app.handle(new Request("http://localhost" + path, init));
}

// Закрывает ОБЕ redis-подключения, которые тестовый процесс успел открыть:
// собственный клиент этого файла и общий клиент приложения
// (lib/shared-instances::getRedisClient(), которым пользуются context/index.ts
// и CacheControlService) — иначе процесс не завершится сам, дожидаясь
// таймаута открытого сокета. Сперва явно сносит тестовый неймспейс
// (teardownTestNamespace() идемпотентна, так что afterAll() выше её не
// продублирует).
export async function closeTestRedis() {
  await teardownTestNamespace();
  await redis.quit();
  if (appRedisClient) {
    await appRedisClient.quit();
  }
}
