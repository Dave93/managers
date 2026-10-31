// Маршруты API Workly для экрана HR (раздел 5.7 спеки). Все — под правом kpi.manage.
//
// Организация в запросе обязана быть организацией одного из подключений (CONNECTIONS):
// это проверяется до любой другой работы, иначе 404 organization_not_connected.
// Идентификатор компании и ключ подключения клиент не передаёт никогда.
//
// Тяжёлые обходы Workly в запросе не выполняются: «Проверить» и синхронизация посещаемости
// создают строку журнала и ставят задачу в очередь (202). Синхронно ходят в Workly только
// поиск сотрудников на холодном кэше (один обход) и обновление списка локаций (один запрос).
//
// Коды ответов, которые вводят маршруты: organization_not_connected, employee_not_found,
// workly_employee_not_found, queue_unavailable (в журнал пишется enqueue_failed).
// Сбой Workly отдаётся только кодом: not_configured — 422, прочие коды WorklyError — 502,
// любая другая ошибка обхода — 502 crawl_failed. Текст исключения в ответ и лог не попадает.
import { ctx } from "@backend/context";
import type { DrizzleDB } from "@backend/lib/db";
import { employees, organization, terminals, workly_locations, workly_sync_runs } from "backend/drizzle/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import Elysia, { t } from "elysia";
import type Redis from "ioredis";
import { parsePeriod, type DbLike } from "../kpi/access";
import { KpiError, run } from "../kpi/errors";
import { iso } from "../kpi/iso";
import { matchesName, searchWords } from "../kpi/name-search";
import { assertAttendanceSyncable } from "./attendance";
import { clientFor, WorklyError, type WorklyClient } from "./client";
import { CONNECTIONS, credsFromEnv, resolveOrganizationId } from "./config";
import { refreshLocations, setLocationTerminal } from "./locations";
import { qualityReport } from "./quality";
import { enqueueRun } from "./queue";
import { applyRun, getRun, linkManually, resolveConnKey, startRun, type RunKind } from "./runs";
import type { ConnKey, WorklyEmployee, WorklyLocationRef } from "./types";

// ---------- схемы ----------

// Строгий uuid. Формат "uuid" у Elysia пропускает префикс urn:uuid:, который Postgres не примет.
const Uuid = t.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const INT4_MAX = 2_147_483_647;
const EXCLUDE_MAX_ITEMS = 2000;
const EXCLUDE_KEY_MAX = 100;
const QUERY_MAX = 200;

// ---------- организация подключения ----------

/**
 * Подключение организации. Обратное соответствие (connKeyOf) ищет по имени, а имена
 * организаций не уникальны и выключенная строка тоже находится: подключённой считается
 * только та организация, на которую указывает само подключение (organizationIdOf).
 */
async function connected(db: DbLike, organizationId: string): Promise<{ key: ConnKey; id: string }> {
  const key = await resolveConnKey(db, organizationId);
  const id = key ? await resolveOrganizationId(db, key) : null;
  if (!key || !id || id.toLowerCase() !== organizationId.toLowerCase()) throw new KpiError(404, "organization_not_connected");
  return { key, id };
}

// ---------- обращения к Workly ----------

// Вызов Workly: ошибка становится кодом, текст исключения не уходит ни в ответ, ни в лог.
async function workly<T>(what: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    const code = e instanceof WorklyError ? e.code : "crawl_failed";
    console.error(`workly: ${what}: ошибка ${code}`);
    throw new KpiError(code === "not_configured" ? 422 : 502, code);
  }
}

// clientFor бросает синхронно (нет переменных окружения): тоже через workly().
const clientOf = (what: string, key: ConnKey, redis: Redis): Promise<WorklyClient> =>
  workly(what, async () => clientFor(key, redis));

// ---------- статус ----------

const lastRunColumns = {
  id: workly_sync_runs.id,
  kind: workly_sync_runs.kind,
  status: workly_sync_runs.status,
  trigger: workly_sync_runs.trigger,
  block_reason: workly_sync_runs.block_reason,
  counts: workly_sync_runs.counts,
  period: workly_sync_runs.period,
  error: workly_sync_runs.error,
  created_at: workly_sync_runs.created_at,
  applied_at: workly_sync_runs.applied_at,
};

type LastRun = ReturnType<typeof lastRunOf>;

// Последний прогон организации (любого вида или только kind), без плана.
async function lastRun(db: DbLike, organizationId: string, kind?: RunKind): Promise<LastRun | null> {
  const where = kind
    ? and(eq(workly_sync_runs.organization_id, organizationId), eq(workly_sync_runs.kind, kind))
    : eq(workly_sync_runs.organization_id, organizationId);
  const [r] = await db
    .select(lastRunColumns)
    .from(workly_sync_runs)
    .where(where)
    .orderBy(desc(workly_sync_runs.created_at), desc(workly_sync_runs.id))
    .limit(1);
  return r ? lastRunOf(r) : null;
}

/**
 * Состояние подключений для экрана HR и мастера файловой загрузки: по строке на подключение
 * в порядке CONNECTIONS. Workly не вызывается, переменные окружения только проверяются на
 * наличие. last_run — последний прогон любого вида, без плана; error — его код, если он упал.
 * last_employees_run и last_attendance_run — последний прогон каждого вида: синхронизация
 * посещаемости не прячет готовый план сотрудников, а проверка — идущую синхронизацию.
 */
async function statusOf(db: DbLike) {
  const out = [];
  for (const c of CONNECTIONS) {
    const id = await resolveOrganizationId(db, c.key);
    let name = c.organizationName;
    let last: LastRun | null = null;
    let lastEmployees: LastRun | null = null;
    let lastAttendance: LastRun | null = null;
    if (id) {
      const [org] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, id)).limit(1);
      if (org) name = org.name;
      last = await lastRun(db, id);
      lastEmployees = await lastRun(db, id, "employees");
      lastAttendance = await lastRun(db, id, "attendance");
    }
    out.push({
      key: c.key,
      organization_id: id,
      organization_name: name,
      configured: credsFromEnv(c.key, process.env) !== null,
      last_run: last,
      last_employees_run: lastEmployees,
      last_attendance_run: lastAttendance,
      error: last?.status === "failed" ? last.error : null,
    });
  }
  return out;
}

function lastRunOf(r: { [K in keyof typeof lastRunColumns]: (typeof workly_sync_runs.$inferSelect)[K] }) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    trigger: r.trigger,
    block_reason: r.block_reason ?? null,
    counts: (r.counts ?? {}) as Record<string, number | string>,
    period: r.period ?? null,
    error: r.error ?? null,
    created_at: iso(r.created_at),
    applied_at: iso(r.applied_at),
  };
}

// ---------- запуск прогона ----------

/**
 * Создаёт строку running и ставит задачу в очередь; ответ 202. Без переменных подключения —
 * 422 not_configured, у посещаемости закрытый месяц — 409 period_closed; в обоих случаях
 * строки нет. Задачу не удалось поставить — строка закрывается как failed/enqueue_failed
 * (только если она ещё running), ответ 503 queue_unavailable.
 */
async function startSync(
  db: DrizzleDB,
  organizationId: string,
  kind: RunKind,
  userId: string,
  period?: unknown
): Promise<{ run_id: string; status: "running" }> {
  const org = await connected(db, organizationId);
  const month = kind === "attendance" ? parsePeriod(period) : undefined;
  if (!credsFromEnv(org.key, process.env)) throw new KpiError(422, "not_configured");
  if (month) await assertAttendanceSyncable(db, month);
  const { run_id } = await startRun(db, org, kind, "manual", userId, month);
  try {
    await enqueueRun(run_id);
  } catch {
    console.error(`workly: прогон ${run_id}: задача не поставлена в очередь, ошибка enqueue_failed`);
    try {
      await db
        .update(workly_sync_runs)
        .set({ status: "failed", error: "enqueue_failed" })
        .where(and(eq(workly_sync_runs.id, run_id), eq(workly_sync_runs.status, "running")));
    } catch {
      // Строку закроет как stale следующий запуск через 15 минут.
      console.error(`workly: прогон ${run_id}: не удалось записать статус failed`);
    }
    throw new KpiError(503, "queue_unavailable");
  }
  return { run_id, status: "running" };
}

// ---------- сотрудники Workly (кэш) ----------

interface WorklyPerson {
  id: number;
  full_name: string;
  tab_number: string;
  locations: WorklyLocationRef[];
}
interface EmployeesCache {
  company_id: number;
  items: WorklyPerson[];
}

const EMP_CACHE_TTL_S = 600;
const SEARCH_LIMIT = 50;

const empCacheKey = (organizationId: string) => `${process.env.PROJECT_PREFIX}workly_emp_cache:${organizationId}`;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Только то, что нужно экрану и связи: имя «Фамилия Имя», табельный номер, локации.
function personOf(w: WorklyEmployee): WorklyPerson | null {
  if (!Number.isInteger(w?.id)) return null;
  return {
    id: w.id,
    full_name: [str(w.last_name), str(w.first_name)].filter(Boolean).join(" "),
    tab_number: str(w.tab_number),
    locations: (Array.isArray(w.locations) ? w.locations : [])
      .filter((l) => Number.isInteger(l?.id))
      .map((l) => ({ id: l.id, title: str(l.title) })),
  };
}

const byName = (a: WorklyPerson, b: WorklyPerson) => a.full_name.localeCompare(b.full_name, "ru") || a.id - b.id;

async function readEmployeesCache(redis: Redis, organizationId: string): Promise<EmployeesCache | null> {
  let raw: string | null;
  try {
    raw = await redis.get(empCacheKey(organizationId));
  } catch {
    // Redis недоступен: идём в Workly. Ошибку не логируем: в ней аргументы команды.
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (Number.isInteger(v?.company_id) && Array.isArray(v.items)) return v as EmployeesCache;
  } catch {
    // повреждённое значение — как отсутствие
  }
  return null;
}

/**
 * Активные сотрудники Workly организации из кэша Redis (10 минут). На промахе — один обход
 * (компания, затем список, строго по очереди), результат кладётся в кэш. Неудачный обход
 * не кэшируется. Два запроса на холодном кэше могут обойти Workly оба: блокировки нет.
 */
async function worklyEmployees(redis: Redis, org: { key: ConnKey; id: string }): Promise<EmployeesCache> {
  const hit = await readEmployeesCache(redis, org.id);
  if (hit) return hit;
  const client = await clientOf("список сотрудников", org.key, redis);
  const company_id = await workly("список сотрудников", () => client.companyId());
  const list = await workly("список сотрудников", () => client.employees());
  const items = list.map(personOf).filter((p): p is WorklyPerson => p !== null).sort(byName);
  const value: EmployeesCache = { company_id, items };
  try {
    await redis.set(empCacheKey(org.id), JSON.stringify(value), "EX", EMP_CACHE_TTL_S);
  } catch {
    console.error("workly: список сотрудников: кэш не записан");
  }
  return value;
}

// Поиск по подстрокам имени: все слова запроса в «Фамилия Имя», порядок и регистр не важны.
// Слова без пробелов, поэтому поиск по склеенному имени совпадает с поиском по имени и фамилии.
function search(items: WorklyPerson[], q: string | undefined): WorklyPerson[] {
  const words = searchWords(q ?? "");
  const out: WorklyPerson[] = [];
  for (const p of items) {
    if (!matchesName(words, { first_name: p.full_name, last_name: "" })) continue;
    out.push({ id: p.id, full_name: p.full_name, tab_number: p.tab_number, locations: p.locations });
    if (out.length === SEARCH_LIMIT) break;
  }
  return out;
}

// ---------- ручная связь ----------

/**
 * Связывает нашего сотрудника организации с записью Workly из кэша поиска: компания и
 * табельный номер берутся оттуда же, клиент их не передаёт. Сотрудник не этой организации —
 * 404 employee_not_found (проверка до обхода Workly); записи нет в списке — 404
 * workly_employee_not_found; workly_id занят — 409 workly_id_taken (из linkManually).
 */
async function linkEmployee(
  db: DrizzleDB,
  redis: Redis,
  b: { organization_id: string; employee_id: string; workly_id: number },
  userId: string
): Promise<{ ok: true }> {
  const org = await connected(db, b.organization_id);
  const [own] = await db
    .select({ id: employees.id })
    .from(employees)
    .innerJoin(terminals, eq(terminals.id, employees.terminal_id))
    .where(and(eq(employees.id, b.employee_id), eq(terminals.organization_id, org.id)))
    .limit(1);
  if (!own) throw new KpiError(404, "employee_not_found");

  const cache = await worklyEmployees(redis, org);
  const w = cache.items.find((p) => p.id === b.workly_id);
  if (!w) throw new KpiError(404, "workly_employee_not_found");
  await linkManually(
    db,
    { organizationId: org.id, companyId: cache.company_id, employeeId: b.employee_id, worklyId: w.id, tabNumber: w.tab_number },
    userId
  );
  return { ok: true };
}

// ---------- локации ----------

// Карта локаций организации из таблицы, без обращения к Workly.
async function locationsOf(db: DbLike, organizationId: string) {
  return db
    .select({
      id: workly_locations.id,
      workly_location_id: workly_locations.workly_location_id,
      title: workly_locations.title,
      terminal_id: workly_locations.terminal_id,
      terminal_name: terminals.name,
    })
    .from(workly_locations)
    .leftJoin(terminals, eq(terminals.id, workly_locations.terminal_id))
    .where(eq(workly_locations.organization_id, organizationId))
    .orderBy(asc(workly_locations.title), asc(workly_locations.workly_location_id));
}

// Один запрос компании и один обход /v1/locations, затем карта из таблицы.
async function refreshOf(db: DrizzleDB, redis: Redis, organizationId: string) {
  const org = await connected(db, organizationId);
  const client = await clientOf("локации", org.key, redis);
  const companyId = await workly("локации", () => client.companyId());
  await refreshLocations(db, { locations: () => workly("локации", () => client.locations()) }, companyId, org.id);
  return locationsOf(db, org.id);
}

// Привязка локации: организация берётся из самой строки локации и должна быть подключена.
async function setTerminal(db: DbLike, locationId: string, terminalId: string | null): Promise<{ ok: true }> {
  const [row] = await db
    .select({ organization_id: workly_locations.organization_id })
    .from(workly_locations)
    .where(eq(workly_locations.id, locationId))
    .limit(1);
  if (!row) throw new KpiError(404, "location_not_found");
  const org = await connected(db, row.organization_id);
  await setLocationTerminal(db, locationId, terminalId, org.id);
  return { ok: true };
}

// ---------- терминалы организации ----------

/**
 * Активные терминалы подключённой организации для выбора в карте локаций, по названию.
 * Список терминалов KPI (/kpi/terminals) организацию не отдаёт, поэтому нужен свой.
 */
async function terminalsOf(db: DbLike, organizationId: string) {
  const org = await connected(db, organizationId);
  return db
    .select({ id: terminals.id, name: terminals.name })
    .from(terminals)
    .where(and(eq(terminals.organization_id, org.id), eq(terminals.active, true)))
    .orderBy(asc(terminals.name), asc(terminals.id));
}

// ---------- маршруты ----------

const worklyRoutes = new Elysia({ name: "@api/workly/routes" })
  .use(ctx)
  .get("/workly/status", async ({ drizzle, set }) => run(set, () => statusOf(drizzle)), { permission: "kpi.manage" })
  .post(
    "/workly/sync/plan",
    async ({ body, user, drizzle, set }) =>
      run(set, async () => {
        const res = await startSync(drizzle, body.organization_id, "employees", user!.id);
        set.status = 202;
        return res;
      }),
    { permission: "kpi.manage", body: t.Object({ organization_id: Uuid }) }
  )
  .get("/workly/sync/runs/:id", async ({ params, drizzle, set }) => run(set, () => getRun(drizzle, params.id)), {
    permission: "kpi.manage",
    params: t.Object({ id: Uuid }),
  })
  .post(
    "/workly/sync/apply",
    async ({ body, user, drizzle, set }) =>
      run(set, async () => {
        // Применение пишет сотрудников: прогон должен быть прогоном подключённой организации.
        const r = await getRun(drizzle, body.run_id);
        await connected(drizzle, r.organization_id);
        return applyRun(drizzle, body.run_id, body.exclude, user!.id);
      }),
    {
      permission: "kpi.manage",
      body: t.Object({
        run_id: Uuid,
        exclude: t.Array(t.String({ maxLength: EXCLUDE_KEY_MAX }), { maxItems: EXCLUDE_MAX_ITEMS }),
      }),
    }
  )
  .get(
    "/workly/employees",
    async ({ query, drizzle, redis, set }) =>
      run(set, async () => {
        const org = await connected(drizzle, query.organization_id);
        return search((await worklyEmployees(redis, org)).items, query.q);
      }),
    {
      permission: "kpi.manage",
      query: t.Object({ organization_id: Uuid, q: t.Optional(t.String({ maxLength: QUERY_MAX })) }),
    }
  )
  .post(
    "/workly/sync/link",
    async ({ body, user, drizzle, redis, set }) => run(set, () => linkEmployee(drizzle, redis, body, user!.id)),
    {
      permission: "kpi.manage",
      body: t.Object({
        organization_id: Uuid,
        employee_id: Uuid,
        workly_id: t.Integer({ minimum: 1, maximum: INT4_MAX }),
      }),
    }
  )
  .get(
    "/workly/locations",
    async ({ query, drizzle, set }) =>
      run(set, async () => locationsOf(drizzle, (await connected(drizzle, query.organization_id)).id)),
    { permission: "kpi.manage", query: t.Object({ organization_id: Uuid }) }
  )
  .post(
    "/workly/locations/refresh",
    async ({ body, drizzle, redis, set }) => run(set, () => refreshOf(drizzle, redis, body.organization_id)),
    { permission: "kpi.manage", body: t.Object({ organization_id: Uuid }) }
  )
  .put(
    "/workly/locations/:id",
    async ({ params, body, drizzle, set }) => run(set, () => setTerminal(drizzle, params.id, body.terminal_id)),
    {
      permission: "kpi.manage",
      params: t.Object({ id: Uuid }),
      body: t.Object({ terminal_id: t.Union([Uuid, t.Null()]) }),
    }
  )
  .post(
    "/workly/attendance/sync",
    async ({ body, user, drizzle, set }) =>
      run(set, async () => {
        const res = await startSync(drizzle, body.organization_id, "attendance", user!.id, body.period);
        set.status = 202;
        return res;
      }),
    { permission: "kpi.manage", body: t.Object({ organization_id: Uuid, period: t.Optional(t.String()) }) }
  )
  .get(
    "/workly/quality",
    async ({ query, drizzle, set }) =>
      run(set, async () => {
        const org = await connected(drizzle, query.organization_id);
        return qualityReport(drizzle, org.id, parsePeriod(query.period));
      }),
    { permission: "kpi.manage", query: t.Object({ organization_id: Uuid, period: t.Optional(t.String()) }) }
  )
  .get("/workly/terminals", async ({ query, drizzle, set }) => run(set, () => terminalsOf(drizzle, query.organization_id)), {
    permission: "kpi.manage",
    query: t.Object({ organization_id: Uuid }),
  });

// Типы ответов для админки (`import type`: в рантайм ничего не попадает). Выведены из самих
// функций маршрутов, поэтому не расходятся с ответом сервера.
export type WorklyStatusEntry = Awaited<ReturnType<typeof statusOf>>[number];
export type WorklyLocationRow = Awaited<ReturnType<typeof locationsOf>>[number];
export type WorklyPersonRow = Awaited<ReturnType<typeof search>>[number];
export type WorklyRunStarted = Awaited<ReturnType<typeof startSync>>;
export type WorklyTerminalRow = Awaited<ReturnType<typeof terminalsOf>>[number];

const worklyControllerImpl = new Elysia({ name: "@api/workly", prefix: "/api" })
  .use(ctx)
  .guard({ detail: { hide: true } })
  .use(worklyRoutes);

export const worklyController = worklyControllerImpl as unknown as Elysia;
