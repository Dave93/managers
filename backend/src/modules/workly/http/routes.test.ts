import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в kpi/http/attendance.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/routes (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/routes.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { ensureApp, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { addAttendance, api: rawApi, cleanupKpi, makeTerminal, setNow, setup } = await import("../../kpi/http/fixtures");
  const { employees, kpi_periods, organization, terminals, workly_locations, workly_sync_runs } = await import("backend/drizzle/schema");
  const { getRedisClient } = await import("backend/src/lib/shared-instances");
  const { WorklyError, setClientFactory } = await import("../client");
  const config = await import("../config");
  const runs = await import("../runs");
  const queue = await import("../queue");
  const { and, eq } = await import("drizzle-orm");
  type Session = Awaited<ReturnType<typeof withSession>>;
  type ConnKey = import("../types").ConnKey;
  type RunClient = import("../runs").RunClient;
  type WorklyEmployee = import("../types").WorklyEmployee;
  type WorklyLocation = import("../types").WorklyLocation;
  type ClientFactory = NonNullable<Parameters<typeof setClientFactory>[0]>;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;
  // Redis клиенту Workly не нужен: executeRun в тестах всегда получает свой clientOf.
  const redis = {} as unknown as Redis;

  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 700_000_000 + Math.floor(Math.random() * 100_000_000);
  // 12:00 по Ташкенту 20 октября: октябрь открыт, в нём есть прошедшие дни.
  const NOW = "2026-10-20T07:00:00.000Z";
  const P = "2026-10-01";

  // ---------- переменные окружения Workly ----------

  // Поддельные значения: ни одно не должно появиться ни в одном ответе.
  const FAKE_ENV: Record<string, string> = {
    WORKLY_BASE_URL: "https://wl-base-3f9d1c.invalid",
    WORKLY_LES_CLIENT_ID: "les-client-id-8a2e41",
    WORKLY_LES_CLIENT_SECRET: "les-client-secret-c07b95",
    WORKLY_LES_USERNAME: "les-user-5d13f0",
    WORKLY_LES_PASSWORD: "les-password-e6a2b7",
    WORKLY_CHOPAR_CLIENT_ID: "chopar-client-id-71c9de",
    WORKLY_CHOPAR_CLIENT_SECRET: "chopar-client-secret-2b84fa",
    WORKLY_CHOPAR_USERNAME: "chopar-user-90e3c6",
    WORKLY_CHOPAR_PASSWORD: "chopar-password-4f61a8",
  };
  const SECRETS = Object.values(FAKE_ENV);
  const savedEnv: Record<string, string | undefined> = {};
  const setEnv = () => {
    for (const [k, v] of Object.entries(FAKE_ENV)) process.env[k] = v;
  };
  const unsetEnv = () => {
    for (const k of Object.keys(FAKE_ENV)) delete process.env[k];
  };

  // ---------- подключения: тестовые организации вместо «Les Ailes» и «ChoparPizza» ----------

  let conn: Record<ConnKey, string | null> = { LES: null, CHOPAR: null };
  // Дополнительные организации, которые подключение «узнаёт» по id (для проверки обратного соответствия).
  const extraKeys = new Map<string, ConnKey>();

  // ---------- подставные клиент, фабрика и очередь ----------

  type Fake = RunClient & { calls: string[] };
  function fakeClient(
    company: number,
    o: { employees?: WorklyEmployee[]; locations?: WorklyLocation[]; fail?: { method: string; error: unknown } } = {}
  ): Fake {
    const fake = { calls: [] as string[] } as Fake;
    const wrap =
      <T>(method: string, value: () => T) =>
      async (..._args: unknown[]): Promise<T> => {
        fake.calls.push(method);
        await new Promise((r) => setTimeout(r, 1));
        if (o.fail?.method === method) throw o.fail.error;
        return value();
      };
    Object.assign(fake, {
      companyId: wrap("companyId", () => company),
      employees: wrap("employees", () => o.employees ?? []),
      dismissed: wrap("dismissed", () => []),
      locations: wrap("locations", () => o.locations ?? []),
      t12: wrap("t12", () => []),
      lateIn: wrap("lateIn", () => []),
      absence: wrap("absence", () => []),
    });
    return fake;
  }

  // Клиент по ключу подключения; ключа нет — фабрика бросает not_configured, как без переменных.
  let clients: Partial<Record<ConnKey, Fake>> = {};
  let factoryCalls: ConnKey[] = [];
  const factory = ((key: ConnKey) => {
    factoryCalls.push(key);
    const c = clients[key];
    if (!c) throw new WorklyError("not_configured", `Подключение Workly ${key} не настроено`);
    return c;
  }) as unknown as ClientFactory;

  let enqueued: string[] = [];
  const defaultEnqueuer = async (id: string) => {
    enqueued.push(id);
  };

  // ---------- запросы ----------

  // Каждое тело ответа сохраняется: в конце проверяем, что ни в одном нет секретов из env.
  const bodies: string[] = [];
  async function api(s: Session | null, method: string, path: string, body?: unknown) {
    const r = await rawApi(s, method, path, body);
    bodies.push(JSON.stringify(r.body));
    return r;
  }

  let hr: Session;
  let viewer: Session;

  // ---------- данные ----------

  const makeOrg = async (): Promise<string> => {
    const [row] = await db.insert(organization).values({ name: `wl_test_routes_${hex()}` }).returning({ id: organization.id });
    return row.id;
  };
  const orgName = async (id: string) => (await db.select().from(organization).where(eq(organization.id, id)))[0].name;

  // Две подключённые организации (LES, CHOPAR) и одна неподключённая.
  async function world() {
    const les = await makeOrg();
    const chopar = await makeOrg();
    const other = await makeOrg();
    conn = { LES: les, CHOPAR: chopar };
    return { les, chopar, other };
  }

  type Person = { first_name: string; last_name: string };
  const person = (): Person => ({ first_name: "Тест", last_name: "R" + hex() });

  const wEmp = (id: number, p: Person, o: { loc?: number; title?: string; tab?: string } = {}): WorklyEmployee => ({
    id,
    first_name: p.first_name,
    last_name: p.last_name,
    patronymic: "Отчество",
    tab_number: o.tab ?? `T${id}`,
    start_date: "2026-01-01",
    positions: o.title ? [{ id: 1, title: o.title }] : [],
    locations: o.loc != null ? [{ id: o.loc, title: `L${o.loc}` }] : [],
  });

  const mkEmp = async (o: { p?: Person; terminal_id: string; position?: string; link?: { company: number; id: number }; tab?: string }) => {
    const p = o.p ?? person();
    const [row] = await db
      .insert(employees)
      .values({
        first_name: p.first_name,
        last_name: p.last_name,
        terminal_id: o.terminal_id,
        position: o.position ?? null,
        workly_company_id: o.link?.company ?? null,
        workly_id: o.link?.id ?? null,
        workly_tab_number: o.tab ?? null,
      })
      .returning({ id: employees.id });
    return row.id;
  };
  const emp = async (id: string) => (await db.select().from(employees).where(eq(employees.id, id)))[0];
  const runsOf = async (org: string) => db.select().from(workly_sync_runs).where(eq(workly_sync_runs.organization_id, org));
  const rawRun = async (id: string) => (await db.select().from(workly_sync_runs).where(eq(workly_sync_runs.id, id)))[0];
  const locationsOf = async (org: string) => db.select().from(workly_locations).where(eq(workly_locations.organization_id, org));

  const mapLocation = async (org: string, company: number, loc: number, terminal: string | null, title = `L${loc}`) => {
    const [row] = await db
      .insert(workly_locations)
      .values({ organization_id: org, workly_company_id: company, workly_location_id: loc, title, terminal_id: terminal })
      .returning({ id: workly_locations.id });
    return row.id;
  };

  const plan = (s: Session, org: string) => api(s, "POST", "/api/workly/sync/plan", { organization_id: org });
  const getRunApi = (id: string) => api(hr, "GET", `/api/workly/sync/runs/${id}`);

  // Полный список маршрутов с корректными по схеме входными данными.
  const ROUTES = (org: string): [string, string, unknown?][] => [
    ["GET", "/api/workly/status"],
    ["POST", "/api/workly/sync/plan", { organization_id: org }],
    ["GET", `/api/workly/sync/runs/${randomUUID()}`],
    ["POST", "/api/workly/sync/apply", { run_id: randomUUID(), exclude: [] }],
    ["GET", `/api/workly/employees?organization_id=${org}&q=test`],
    ["POST", "/api/workly/sync/link", { organization_id: org, employee_id: randomUUID(), workly_id: 1 }],
    ["GET", `/api/workly/locations?organization_id=${org}`],
    ["POST", "/api/workly/locations/refresh", { organization_id: org }],
    ["PUT", `/api/workly/locations/${randomUUID()}`, { terminal_id: null }],
    ["POST", "/api/workly/attendance/sync", { organization_id: org, period: P }],
    ["GET", `/api/workly/quality?organization_id=${org}&period=${P}`],
    ["GET", `/api/workly/terminals?organization_id=${org}`],
  ];

  describe("workly: маршруты API", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      for (const k of Object.keys(FAKE_ENV)) savedEnv[k] = process.env[k];
      setEnv();
      runs.setConnKeyResolver(async (_db, id) =>
        id === conn.LES ? "LES" : id === conn.CHOPAR ? "CHOPAR" : extraKeys.get(id) ?? null
      );
      config.setOrganizationResolver(async (_db, key) => conn[key]);
      setClientFactory(factory);
      queue.setRunEnqueuer(defaultEnqueuer);
      // withSession по одному: кэш ролей пишется через чтение-изменение-запись.
      hr = await withSession({ permissions: ["kpi.manage"] });
      viewer = await withSession({ permissions: ["kpi.view", "kpi.evaluate", "kpi.approve"] });
    }, 180000);

    afterAll(async () => {
      runs.setConnKeyResolver(null);
      config.setOrganizationResolver(null);
      setClientFactory(null);
      queue.setRunEnqueuer(null);
      setNow(null);
      // undefined в process.env записался бы строкой "undefined": такие переменные удаляем.
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    const reset = () => {
      clients = {};
      factoryCalls = [];
      enqueued = [];
    };

    // ---------- доступ ----------

    it("без сессии 401, без kpi.manage 403 на каждом маршруте; ничего не создано, клиент и очередь не тронуты", async () => {
      reset();
      const w = await world();
      clients = { LES: fakeClient(newCompany()), CHOPAR: fakeClient(newCompany()) };
      for (const [method, path, body] of ROUTES(w.les)) {
        expect(`${method} ${path} → ${(await api(null, method, path, body)).status}`).toBe(`${method} ${path} → 401`);
        expect(`${method} ${path} → ${(await api(viewer, method, path, body)).status}`).toBe(`${method} ${path} → 403`);
      }
      expect(factoryCalls).toEqual([]);
      expect(enqueued).toEqual([]);
      expect(await runsOf(w.les)).toEqual([]);
      expect(await locationsOf(w.les)).toEqual([]);
    });

    it("ROUTES перечисляет все маршруты /api/workly: забытый в списке маршрут роняет этот тест", async () => {
      // Тип приложения слишком глубокий для tsc: берём только то, что нужно.
      const app = (await ensureApp()) as unknown as { routes: { method: string; path: string }[] };
      const registered = [...new Set(app.routes.filter((r) => r.path.startsWith("/api/workly/")).map((r) => `${r.method} ${r.path}`))];
      const listed = ROUTES(randomUUID());
      expect(registered.length).toBe(listed.length);
      // Каждый маршрут списка совпадает ровно с одним зарегистрированным (`:id` — любой сегмент).
      const pattern = (p: string) => new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+") + "$");
      const matched = listed.map(([method, path]) => {
        const hits = registered.filter((r) => {
          const [m, p] = r.split(" ");
          return m === method && pattern(p).test(path.split("?")[0]);
        });
        expect(`${method} ${path} → ${hits.length}`).toBe(`${method} ${path} → 1`);
        return hits[0];
      });
      expect(new Set(matched).size).toBe(registered.length);
    });

    // ---------- схема ----------

    it("схема: кривой uuid, urn:uuid, нецелый workly_id и раздутый exclude — 422 без обращения к базе, клиенту и очереди", async () => {
      reset();
      const w = await world();
      clients = { LES: fakeClient(newCompany()) };
      const t = (await makeTerminal(db, { organization_id: w.les })).id;
      const e = await mkEmp({ terminal_id: t });
      const locId = await mapLocation(w.les, newCompany(), 1, null);
      const bad = "not-a-uuid";
      const urn = `urn:uuid:${randomUUID()}`;
      const id = randomUUID();
      const cases: [string, string, unknown?][] = [
        ["POST", "/api/workly/sync/plan", { organization_id: bad }],
        ["POST", "/api/workly/sync/plan", { organization_id: urn }],
        ["POST", "/api/workly/sync/plan", {}],
        ["GET", `/api/workly/sync/runs/${bad}`],
        ["GET", `/api/workly/sync/runs/${urn}`],
        ["POST", "/api/workly/sync/apply", { run_id: bad, exclude: [] }],
        ["POST", "/api/workly/sync/apply", { run_id: urn, exclude: [] }],
        ["POST", "/api/workly/sync/apply", { run_id: id }],
        ["POST", "/api/workly/sync/apply", { run_id: id, exclude: "link:x" }],
        ["POST", "/api/workly/sync/apply", { run_id: id, exclude: [1] }],
        ["POST", "/api/workly/sync/apply", { run_id: id, exclude: Array.from({ length: 2001 }, (_, k) => `k${k}`) }],
        ["POST", "/api/workly/sync/apply", { run_id: id, exclude: ["x".repeat(101)] }],
        ["GET", `/api/workly/employees?organization_id=${bad}`],
        ["GET", `/api/workly/employees?organization_id=${urn}`],
        ["GET", `/api/workly/employees?organization_id=${w.les}&q=${"a".repeat(201)}`],
        ["POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e, workly_id: 1.5 }],
        ["POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e, workly_id: "abc" }],
        ["POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e, workly_id: 2 ** 31 }],
        ["POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e, workly_id: 0 }],
        ["POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: bad, workly_id: 1 }],
        ["POST", "/api/workly/sync/link", { organization_id: bad, employee_id: e, workly_id: 1 }],
        ["GET", `/api/workly/locations?organization_id=${urn}`],
        ["POST", "/api/workly/locations/refresh", { organization_id: bad }],
        ["PUT", `/api/workly/locations/${bad}`, { terminal_id: null }],
        ["PUT", `/api/workly/locations/${locId}`, { terminal_id: bad }],
        ["PUT", `/api/workly/locations/${locId}`, { terminal_id: urn }],
        ["PUT", `/api/workly/locations/${locId}`, {}],
        ["POST", "/api/workly/attendance/sync", { organization_id: bad, period: P }],
        ["GET", `/api/workly/quality?organization_id=${bad}&period=${P}`],
        ["GET", `/api/workly/terminals?organization_id=${bad}`],
        ["GET", `/api/workly/terminals?organization_id=${urn}`],
        ["GET", "/api/workly/terminals"],
      ];
      for (const [method, path, body] of cases) {
        const r = await api(hr, method, path, body);
        expect(`${method} ${path.slice(0, 80)} ${JSON.stringify(body)?.slice(0, 80)} → ${r.status}`).toBe(
          `${method} ${path.slice(0, 80)} ${JSON.stringify(body)?.slice(0, 80)} → 422`
        );
      }
      expect(factoryCalls).toEqual([]);
      expect(enqueued).toEqual([]);
      expect(await runsOf(w.les)).toEqual([]);
      expect((await emp(e)).workly_id).toBeNull();
      expect((await locationsOf(w.les))[0].terminal_id).toBeNull();

      // Граница exclude: 2000 строк по 100 символов проходят схему (дальше — 404 прогона).
      const edge = await api(hr, "POST", "/api/workly/sync/apply", {
        run_id: id,
        exclude: Array.from({ length: 2000 }, (_, k) => String(k).padStart(100, "x")),
      });
      expect(edge).toMatchObject({ status: 404, body: { error: "run_not_found" } });
    });

    // ---------- статус ----------

    it("status без переменных окружения: обе организации, configured false, клиент не вызывается", async () => {
      reset();
      const w = await world();
      unsetEnv();
      let r: Awaited<ReturnType<typeof api>>;
      try {
        r = await api(hr, "GET", "/api/workly/status");
        expect(r.status).toBe(200);
        expect(r.body).toEqual([
          {
            key: "LES",
            organization_id: w.les,
            organization_name: await orgName(w.les),
            configured: false,
            last_run: null,
            last_employees_run: null,
            last_attendance_run: null,
            error: null,
          },
          {
            key: "CHOPAR",
            organization_id: w.chopar,
            organization_name: await orgName(w.chopar),
            configured: false,
            last_run: null,
            last_employees_run: null,
            last_attendance_run: null,
            error: null,
          },
        ]);
      } finally {
        setEnv();
      }
      const r2 = await api(hr, "GET", "/api/workly/status");
      expect(r2.body.map((x: { configured: boolean }) => x.configured)).toEqual([true, true]);

      // Организация подключения не найдена: id и прогон пусты, имя — из константы подключения.
      conn = { LES: w.les, CHOPAR: null };
      const r3 = await api(hr, "GET", "/api/workly/status");
      expect(r3.body[1]).toEqual({
        key: "CHOPAR",
        organization_id: null,
        organization_name: "ChoparPizza",
        configured: true,
        last_run: null,
        last_employees_run: null,
        last_attendance_run: null,
        error: null,
      });
      expect(factoryCalls).toEqual([]);
      for (const body of [r.body, r2.body, r3.body]) for (const s of SECRETS) expect(JSON.stringify(body)).not.toContain(s);
    });

    it("status: последний прогон любого вида без плана, у упавшего — код ошибки; ответ 200, Workly не вызывается", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let planRunId = "";
      try {
        // LES: фабрика клиента бросает not_configured.
        const a = await plan(hr, w.les);
        expect(a.status).toBe(202);
        await runs.executeRun(db, redis, a.body.run_id, () => {
          throw new WorklyError("not_configured", "Подключение Workly LES не настроено");
        });
        // CHOPAR: сначала сетевая ошибка, затем удачный план.
        const b = await plan(hr, w.chopar);
        await runs.executeRun(db, redis, b.body.run_id, () =>
          fakeClient(company, { fail: { method: "companyId", error: new WorklyError("http_error", "Workly недоступен: сбой сети") } })
        );
        expect((await getRunApi(b.body.run_id)).body).toMatchObject({ status: "failed", error: "http_error" });
        const c = await plan(hr, w.chopar);
        await runs.executeRun(db, redis, c.body.run_id, () => fakeClient(company, { employees: [wEmp(1, person())] }));
        planRunId = c.body.run_id;
      } finally {
        spy.mockRestore();
      }

      factoryCalls = [];
      clients = {}; // любой вызов фабрики бросил бы not_configured
      const r = await api(hr, "GET", "/api/workly/status");
      expect(r.status).toBe(200);
      expect(r.body.map((x: { key: string }) => x.key)).toEqual(["LES", "CHOPAR"]);
      const [les, chopar] = r.body;
      expect(les).toMatchObject({ organization_id: w.les, configured: true, error: "not_configured" });
      expect(les.last_run).toMatchObject({ kind: "employees", status: "failed", trigger: "manual", error: "not_configured" });
      expect(Object.keys(les.last_run).sort()).toEqual(
        ["applied_at", "block_reason", "counts", "created_at", "error", "id", "kind", "period", "status", "trigger"].sort()
      );
      expect(chopar).toMatchObject({ organization_id: w.chopar, error: null });
      expect(chopar.last_run).toMatchObject({ id: planRunId, status: "planned", error: null });
      expect(chopar.last_run.plan).toBeUndefined();
      // Последний прогон каждого вида: у LES — тот же упавший, у CHOPAR — новейший план (не упавший).
      expect(les.last_employees_run).toEqual(les.last_run);
      expect(les.last_attendance_run).toBeNull();
      expect(chopar.last_employees_run).toEqual(chopar.last_run);
      expect(chopar.last_attendance_run).toBeNull();
      expect(JSON.stringify(r.body)).not.toContain("company");
      expect(factoryCalls).toEqual([]);

      // Самый новый прогон — посещаемость в работе: виден он, ошибки нет.
      setNow(NOW);
      try {
        const att = await api(hr, "POST", "/api/workly/attendance/sync", { organization_id: w.chopar, period: P });
        expect(att.status).toBe(202);
        const r2 = await api(hr, "GET", "/api/workly/status");
        expect(r2.body[1].last_run).toMatchObject({ id: att.body.run_id, kind: "attendance", status: "running", period: P });
        expect(r2.body[1].error).toBeNull();
        // Посещаемость не вытесняет готовый план сотрудников.
        expect(r2.body[1].last_employees_run).toMatchObject({ id: planRunId, kind: "employees", status: "planned" });
        expect(r2.body[1].last_attendance_run).toEqual(r2.body[1].last_run);
      } finally {
        setNow(null);
      }
      expect(factoryCalls).toEqual([]);
    });

    it("status: последний прогон каждого вида отдельно, по created_at, без плана; более новый прогон другого вида его не вытесняет", async () => {
      reset();
      const w = await world();
      // Порядок вставки нарочно не совпадает с created_at.
      const ins = async (kind: "employees" | "attendance", status: string, created_at: string) => {
        const [row] = await db
          .insert(workly_sync_runs)
          .values({
            organization_id: w.les,
            workly_company_id: 123456,
            kind,
            trigger: "manual",
            status,
            period: kind === "attendance" ? P : null,
            created_at,
            plan: kind === "employees" ? { items: [], report: {} } : null,
          })
          .returning({ id: workly_sync_runs.id });
        return row.id;
      };
      const e2 = await ins("employees", "planned", "2026-10-02T10:00:00.000Z");
      await ins("employees", "applied", "2026-10-01T10:00:00.000Z");
      await ins("attendance", "applied", "2026-10-01T12:00:00.000Z");
      const a2 = await ins("attendance", "running", "2026-10-03T10:00:00.000Z");
      await ins("employees", "failed", "2026-09-30T10:00:00.000Z");

      const KEYS = ["applied_at", "block_reason", "counts", "created_at", "error", "id", "kind", "period", "status", "trigger"].sort();
      const st = async () => (await api(hr, "GET", "/api/workly/status")).body;
      const [les, chopar] = await st();
      expect(les.last_run).toMatchObject({ id: a2, kind: "attendance", status: "running", period: P });
      expect(les.last_employees_run).toMatchObject({ id: e2, kind: "employees", status: "planned", period: null });
      expect(les.last_attendance_run).toEqual(les.last_run);
      expect(Object.keys(les.last_employees_run).sort()).toEqual(KEYS);
      expect(Object.keys(les.last_attendance_run).sort()).toEqual(KEYS);
      expect(les.error).toBeNull();
      expect(chopar).toMatchObject({ last_run: null, last_employees_run: null, last_attendance_run: null });

      // Проверка сотрудников новее идущей синхронизации: синхронизация остаётся видна своим полем.
      const e3 = await ins("employees", "running", "2026-10-04T10:00:00.000Z");
      const [les2] = await st();
      expect(les2.last_run).toMatchObject({ id: e3, kind: "employees", status: "running" });
      expect(les2.last_employees_run).toEqual(les2.last_run);
      expect(les2.last_attendance_run).toMatchObject({ id: a2, kind: "attendance", status: "running", period: P });
      // Ни плана, ни компании Workly, ни секретов.
      const raw = JSON.stringify(les2);
      expect(raw).not.toContain('"plan"');
      expect(raw).not.toContain("company");
      expect(raw).not.toContain("123456");
      for (const s of SECRETS) expect(raw).not.toContain(s);
      expect(factoryCalls).toEqual([]);
    });

    // ---------- план ----------

    it("plan: 202 и running сразу, пока клиент не ответил; второй plan — 409; executeRun с готовым клиентом даёт planned с планом", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: w.les })).id;
      const p = person();
      const e = await mkEmp({ p, terminal_id: t });

      // Задача из очереди сразу уходит в executeRun с клиентом, чей ответ тест не даёт.
      let rejectPending: (err: unknown) => void = () => {};
      const pending = new Promise<number>((_, rej) => {
        rejectPending = rej;
      });
      const stuck = { ...fakeClient(company), companyId: () => pending } as RunClient;
      let background: Promise<void> | null = null;
      queue.setRunEnqueuer(async (id) => {
        enqueued.push(id);
        background = runs.executeRun(db, redis, id, () => stuck);
      });
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let runId = "";
      try {
        const r = await plan(hr, w.les);
        expect(r.status).toBe(202);
        expect(r.body).toEqual({ run_id: expect.any(String), status: "running" });
        runId = r.body.run_id;
        expect(enqueued).toEqual([runId]);
        expect(background).not.toBeNull();

        const g = await getRunApi(runId);
        expect(g.status).toBe(200);
        expect(g.body).toMatchObject({ id: runId, organization_id: w.les, kind: "employees", trigger: "manual", status: "running", plan: null });
        expect((await rawRun(runId)).created_by).toBe(hr.userId);

        const second = await plan(hr, w.les);
        expect(second).toMatchObject({ status: 409, body: { error: "run_in_progress" } });
        expect(enqueued).toEqual([runId]);

        await runs.executeRun(db, redis, runId, () => fakeClient(company, { employees: [wEmp(1, p)] }));
        const g2 = await getRunApi(runId);
        expect(g2.body).toMatchObject({ id: runId, status: "planned", error: null });
        expect(g2.body.plan.items.map((i: { key: string }) => i.key)).toEqual([`link:${e}`]);
      } finally {
        rejectPending(new WorklyError("http_error", "Workly недоступен"));
        await background;
        spy.mockRestore();
        queue.setRunEnqueuer(defaultEnqueuer);
      }
      // Зависший обход очнулся после planned: строку он не трогает.
      expect((await getRunApi(runId)).body).toMatchObject({ status: "planned", error: null });
      expect(factoryCalls).toEqual([]);
    });

    it("plan: упавший клиент — GET runs/:id показывает failed/client_invalid; неизвестный прогон — 404", async () => {
      reset();
      const w = await world();
      const r = await plan(hr, w.les);
      expect(r.status).toBe(202);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        await runs.executeRun(db, redis, r.body.run_id, () =>
          fakeClient(newCompany(), {
            fail: { method: "companyId", error: new WorklyError("client_invalid", "Workly отклонил client_id/client_secret (код 7003)") },
          })
        );
      } finally {
        spy.mockRestore();
      }
      const g = await getRunApi(r.body.run_id);
      expect(g.status).toBe(200);
      expect(g.body).toMatchObject({ status: "failed", error: "client_invalid", plan: null });
      expect(JSON.stringify(g.body)).not.toContain("7003");
      expect(await getRunApi(randomUUID())).toMatchObject({ status: 404, body: { error: "run_not_found" } });
    });

    it("plan и attendance/sync без переменных окружения — 422 not_configured, строки в журнале нет", async () => {
      reset();
      const w = await world();
      unsetEnv();
      setNow(NOW);
      try {
        expect(await plan(hr, w.les)).toMatchObject({ status: 422, body: { error: "not_configured" } });
        expect(await api(hr, "POST", "/api/workly/attendance/sync", { organization_id: w.les, period: P })).toMatchObject({
          status: 422,
          body: { error: "not_configured" },
        });
      } finally {
        setEnv();
        setNow(null);
      }
      expect(await runsOf(w.les)).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    it("очередь недоступна: 503 queue_unavailable, строка failed/enqueue_failed, running не остаётся; следующий plan проходит", async () => {
      reset();
      const w = await world();
      const logged: string[] = [];
      const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
      queue.setRunEnqueuer(async () => {
        throw new Error(`redis down ${FAKE_ENV.WORKLY_LES_PASSWORD}`);
      });
      setNow(NOW);
      try {
        const r = await plan(hr, w.les);
        expect(r).toEqual({ status: 503, body: { error: "queue_unavailable" } });
        const a = await api(hr, "POST", "/api/workly/attendance/sync", { organization_id: w.les, period: P });
        expect(a).toEqual({ status: 503, body: { error: "queue_unavailable" } });
      } finally {
        spy.mockRestore();
        queue.setRunEnqueuer(defaultEnqueuer);
        setNow(null);
      }
      const rows = await runsOf(w.les);
      expect(rows.map((x) => [x.kind, x.status, x.error]).sort()).toEqual([
        ["attendance", "failed", "enqueue_failed"],
        ["employees", "failed", "enqueue_failed"],
      ]);
      expect(rows.filter((x) => x.status === "running")).toEqual([]);
      expect(logged.join("\n")).not.toContain(FAKE_ENV.WORKLY_LES_PASSWORD);
      expect(logged.join("\n")).toContain("enqueue_failed");

      const again = await plan(hr, w.les);
      expect(again.status).toBe(202);
      expect(enqueued).toEqual([again.body.run_id]);
    });

    // ---------- применение ----------

    it("apply: применяет план, exclude оставляет пункт нетронутым, повторный apply — 409 run_not_planned", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: w.les })).id;
      const pLink = person();
      const pUpd = person();
      const eLink = await mkEmp({ p: pLink, terminal_id: t });
      const eUpd = await mkEmp({ p: pUpd, terminal_id: t, position: "Старая должность", link: { company, id: 2 }, tab: "OLD" });
      const r = await plan(hr, w.les);
      await runs.executeRun(db, redis, r.body.run_id, () =>
        fakeClient(company, { employees: [wEmp(1, pLink), wEmp(2, pUpd, { title: "Кассир" })] })
      );
      const planned = await getRunApi(r.body.run_id);
      expect(planned.body.plan.items.map((i: { key: string }) => i.key).sort()).toEqual([`link:${eLink}`, `update:${eUpd}`].sort());
      const updBefore = await emp(eUpd);

      const res = await api(hr, "POST", "/api/workly/sync/apply", { run_id: r.body.run_id, exclude: [`update:${eUpd}`] });
      expect(res).toEqual({ status: 200, body: { applied: 1, skipped: [{ key: `update:${eUpd}`, reason: "excluded" }] } });
      expect(await emp(eLink)).toMatchObject({ workly_company_id: company, workly_id: 1, workly_tab_number: "T1" });
      expect(await emp(eUpd)).toEqual(updBefore);
      expect((await getRunApi(r.body.run_id)).body.status).toBe("applied");

      const again = await api(hr, "POST", "/api/workly/sync/apply", { run_id: r.body.run_id, exclude: [] });
      expect(again).toEqual({ status: 409, body: { error: "run_not_planned" } });
      expect(await api(hr, "POST", "/api/workly/sync/apply", { run_id: randomUUID(), exclude: [] })).toEqual({
        status: 404,
        body: { error: "run_not_found" },
      });
    });

    // ---------- поиск и ручная связь ----------

    it("employees?q= и link: обход Workly один на два запроса (кэш), link ставит workly_id из кэша", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: w.les })).id;
      const e = await mkEmp({ terminal_id: t });
      const e2 = await mkEmp({ terminal_id: t });
      const list = [
        wEmp(11, { first_name: "Азиз", last_name: "Каримов" }, { tab: "T-11", loc: 5 }),
        wEmp(12, { first_name: "Ёкуб", last_name: "Каримов" }, { tab: "T-12" }),
        wEmp(13, { first_name: "Бобур", last_name: "Юсупов" }, { tab: "T-13" }),
      ];
      const client = fakeClient(company, { employees: list });
      clients = { LES: client };

      const r1 = await api(hr, "GET", `/api/workly/employees?organization_id=${w.les}&q=${encodeURIComponent("каримов")}`);
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual([
        { id: 11, full_name: "Каримов Азиз", tab_number: "T-11", locations: [{ id: 5, title: "L5" }] },
        { id: 12, full_name: "Каримов Ёкуб", tab_number: "T-12", locations: [] },
      ]);
      // ё = е, регистр и порядок слов не важны.
      const r2 = await api(hr, "GET", `/api/workly/employees?organization_id=${w.les}&q=${encodeURIComponent("ЕКУБ кар")}`);
      expect(r2.body.map((x: { id: number }) => x.id)).toEqual([12]);
      expect(client.calls).toEqual(["companyId", "employees"]);
      expect(factoryCalls).toEqual(["LES"]);

      // Кэш: { company_id, items } на 10 минут, в элементах только нужные поля.
      const key = `${process.env.PROJECT_PREFIX}workly_emp_cache:${w.les}`;
      const ttl = await getRedisClient().ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
      const cached = JSON.parse((await getRedisClient().get(key))!);
      expect(cached.company_id).toBe(company);
      expect(cached.items).toHaveLength(3);
      expect(Object.keys(cached.items[0]).sort()).toEqual(["full_name", "id", "locations", "tab_number"]);

      const link = await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e, workly_id: 12 });
      expect(link).toEqual({ status: 200, body: { ok: true } });
      expect(await emp(e)).toMatchObject({ workly_company_id: company, workly_id: 12, workly_tab_number: "T-12" });
      expect(client.calls).toEqual(["companyId", "employees"]);

      // Записи нет в кэше — 404, сотрудник не изменился.
      const before2 = await emp(e2);
      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e2, workly_id: 999 })).toEqual({
        status: 404,
        body: { error: "workly_employee_not_found" },
      });
      // Тот же workly_id у другого сотрудника — 409.
      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: e2, workly_id: 12 })).toEqual({
        status: 409,
        body: { error: "workly_id_taken" },
      });
      expect(await emp(e2)).toEqual(before2);

      // Неподключённая организация — 404 и для поиска, и для связи.
      expect(await api(hr, "GET", `/api/workly/employees?organization_id=${w.other}&q=a`)).toEqual({
        status: 404,
        body: { error: "organization_not_connected" },
      });
      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.other, employee_id: e2, workly_id: 11 })).toEqual({
        status: 404,
        body: { error: "organization_not_connected" },
      });
      expect(await emp(e2)).toEqual(before2);
      expect(client.calls).toEqual(["companyId", "employees"]);
    });

    it("link: сотрудник другой организации — 404 employee_not_found, без изменений; на холодном кэше обход один", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const tChopar = (await makeTerminal(db, { organization_id: w.chopar })).id;
      const tLes = (await makeTerminal(db, { organization_id: w.les })).id;
      const foreign = await mkEmp({ terminal_id: tChopar });
      const own = await mkEmp({ terminal_id: tLes });
      const client = fakeClient(company, { employees: [wEmp(21, person(), { tab: "T-21" })] });
      clients = { LES: client };

      const before = await emp(foreign);
      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: foreign, workly_id: 21 })).toEqual({
        status: 404,
        body: { error: "employee_not_found" },
      });
      expect(await emp(foreign)).toEqual(before);
      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: randomUUID(), workly_id: 21 })).toEqual({
        status: 404,
        body: { error: "employee_not_found" },
      });

      expect(await api(hr, "POST", "/api/workly/sync/link", { organization_id: w.les, employee_id: own, workly_id: 21 })).toEqual({
        status: 200,
        body: { ok: true },
      });
      expect(await emp(own)).toMatchObject({ workly_company_id: company, workly_id: 21, workly_tab_number: "T-21" });
      expect(client.calls).toEqual(["companyId", "employees"]);
    });

    it("employees: не больше 50, по имени; пустой и отсутствующий q — первые 50", async () => {
      reset();
      const w = await world();
      const list = Array.from({ length: 120 }, (_, k) =>
        wEmp(1000 + k, { first_name: "Имя", last_name: `Фамилия${String(k).padStart(3, "0")}` })
      );
      const client = fakeClient(newCompany(), { employees: [...list].reverse() });
      clients = { CHOPAR: client };
      const url = (q?: string) =>
        `/api/workly/employees?organization_id=${w.chopar}${q === undefined ? "" : `&q=${encodeURIComponent(q)}`}`;

      const all = await api(hr, "GET", url());
      expect(all.status).toBe(200);
      expect(all.body).toHaveLength(50);
      expect(all.body.map((x: { id: number }) => x.id)).toEqual(list.slice(0, 50).map((x) => x.id));
      expect((await api(hr, "GET", url(""))).body).toHaveLength(50);
      expect((await api(hr, "GET", url("имя"))).body).toHaveLength(50);
      // фамилия1xx — ровно двадцать.
      const some = await api(hr, "GET", url("фамилия1"));
      expect(some.body.map((x: { id: number }) => x.id)).toEqual(list.slice(100, 120).map((x) => x.id));
      expect((await api(hr, "GET", url("нет-такого"))).body).toEqual([]);
      expect(client.calls).toEqual(["companyId", "employees"]);
    });

    it("employees: сбой Workly — код без текста исключения (502), без переменных — 422 not_configured; сбой не кэшируется", async () => {
      reset();
      const w = await world();
      const logged: string[] = [];
      const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
      });
      try {
        clients = {
          LES: fakeClient(newCompany(), {
            fail: {
              method: "employees",
              error: new WorklyError("client_invalid", `Workly отклонил ${FAKE_ENV.WORKLY_LES_CLIENT_SECRET}`),
            },
          }),
          CHOPAR: fakeClient(newCompany(), { fail: { method: "companyId", error: new Error(`boom ${FAKE_ENV.WORKLY_CHOPAR_PASSWORD}`) } }),
        };
        expect(await api(hr, "GET", `/api/workly/employees?organization_id=${w.les}&q=a`)).toEqual({
          status: 502,
          body: { error: "client_invalid" },
        });
        expect(await api(hr, "GET", `/api/workly/employees?organization_id=${w.chopar}&q=a`)).toEqual({
          status: 502,
          body: { error: "crawl_failed" },
        });
        // Неудача не кэшируется: следующий запрос снова идёт в Workly.
        expect(await api(hr, "GET", `/api/workly/employees?organization_id=${w.les}&q=a`)).toMatchObject({ status: 502 });
        expect(clients.LES!.calls).toEqual(["companyId", "employees", "companyId", "employees"]);

        clients = {};
        expect(await api(hr, "GET", `/api/workly/employees?organization_id=${w.les}`)).toEqual({
          status: 422,
          body: { error: "not_configured" },
        });
        expect(await api(hr, "POST", "/api/workly/locations/refresh", { organization_id: w.les })).toEqual({
          status: 422,
          body: { error: "not_configured" },
        });
      } finally {
        spy.mockRestore();
      }
      const log = logged.join("\n");
      expect(log).not.toContain("boom");
      expect(log).not.toContain("отклонил");
      for (const s of SECRETS) expect(log).not.toContain(s);
    });

    // ---------- локации ----------

    it("locations: GET без обращения к Workly; PUT — чужой терминал 422, свой и null 200; чужая и неизвестная локация 404; refresh — один обход", async () => {
      reset();
      const w = await world();
      const company = newCompany();
      const tA = await makeTerminal(db, { organization_id: w.les });
      const tOther = await makeTerminal(db, { organization_id: w.chopar });
      const l1 = await mapLocation(w.les, company, 1, tA.id, "Б-локация");
      const l2 = await mapLocation(w.les, company, 2, null, "А-локация");
      const lForeign = await mapLocation(w.other, newCompany(), 3, null);
      clients = { LES: fakeClient(company, { locations: [{ id: 1, title: "Б-новое" }, { id: 7, title: "В-новая" }] }) };

      const g = await api(hr, "GET", `/api/workly/locations?organization_id=${w.les}`);
      expect(g).toEqual({
        status: 200,
        body: [
          { id: l2, workly_location_id: 2, title: "А-локация", terminal_id: null, terminal_name: null },
          { id: l1, workly_location_id: 1, title: "Б-локация", terminal_id: tA.id, terminal_name: tA.name },
        ],
      });
      expect(factoryCalls).toEqual([]);

      expect(await api(hr, "PUT", `/api/workly/locations/${l2}`, { terminal_id: tOther.id })).toEqual({
        status: 422,
        body: { error: "terminal_other_org" },
      });
      expect((await db.select().from(workly_locations).where(eq(workly_locations.id, l2)))[0].terminal_id).toBeNull();
      expect(await api(hr, "PUT", `/api/workly/locations/${l2}`, { terminal_id: tA.id })).toEqual({ status: 200, body: { ok: true } });
      expect(await api(hr, "PUT", `/api/workly/locations/${l1}`, { terminal_id: null })).toEqual({ status: 200, body: { ok: true } });
      const after = await locationsOf(w.les);
      expect(Object.fromEntries(after.map((x) => [x.id, x.terminal_id]))).toEqual({ [l1]: null, [l2]: tA.id });

      expect(await api(hr, "PUT", `/api/workly/locations/${randomUUID()}`, { terminal_id: null })).toEqual({
        status: 404,
        body: { error: "location_not_found" },
      });
      expect(await api(hr, "PUT", `/api/workly/locations/${lForeign}`, { terminal_id: null })).toEqual({
        status: 404,
        body: { error: "organization_not_connected" },
      });
      expect(factoryCalls).toEqual([]);

      const ref = await api(hr, "POST", "/api/workly/locations/refresh", { organization_id: w.les });
      expect(ref.status).toBe(200);
      expect(clients.LES!.calls.sort()).toEqual(["companyId", "locations"]);
      expect(ref.body.map((x: { workly_location_id: number; title: string; terminal_id: string | null }) => [x.workly_location_id, x.title, x.terminal_id])).toEqual([
        [2, "А-локация", tA.id],
        [1, "Б-новое", null],
        [7, "В-новая", null],
      ]);
      expect((await api(hr, "GET", `/api/workly/locations?organization_id=${w.les}`)).body).toEqual(ref.body);
    });

    it("terminals: только активные терминалы этой организации, по названию; Workly не вызывается", async () => {
      reset();
      const w = await world();
      const h = hex();
      // Префикс «Тест Филиал » оставляем: по нему cleanupKpi удаляет терминалы.
      const named = async (organization_id: string, suffix: string, active = true) => {
        const t = await makeTerminal(db, { organization_id, active });
        const name = `Тест Филиал ${h} ${suffix}`;
        await db.update(terminals).set({ name }).where(eq(terminals.id, t.id));
        return { id: t.id, name };
      };
      const tV = await named(w.les, "В");
      const tA = await named(w.les, "А");
      await named(w.les, "Аа выключен", false);
      const tB = await named(w.les, "Б");
      await named(w.chopar, "А чужой");
      await named(w.other, "А неподключённый");

      const r = await api(hr, "GET", `/api/workly/terminals?organization_id=${w.les}`);
      expect(r).toEqual({ status: 200, body: [tA, tB, tV] });

      const c = await api(hr, "GET", `/api/workly/terminals?organization_id=${w.chopar}`);
      expect(c.status).toBe(200);
      expect(c.body.map((x: { name: string }) => x.name)).toEqual([`Тест Филиал ${h} А чужой`]);
      expect(factoryCalls).toEqual([]);
    });

    // ---------- посещаемость и качество ----------

    it("attendance/sync: закрытый месяц — 409 period_closed без строки в журнале; мусорный месяц — 422; открытый — 202", async () => {
      reset();
      const w = await world();
      await db
        .insert(kpi_periods)
        .values({ period: "2026-08-01", status: "closed" })
        .onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });
      setNow(NOW);
      try {
        const sync = (period?: unknown) =>
          api(hr, "POST", "/api/workly/attendance/sync", period === undefined ? { organization_id: w.les } : { organization_id: w.les, period });
        expect(await sync("2026-08-01")).toEqual({ status: 409, body: { error: "period_closed" } });
        expect(await runsOf(w.les)).toEqual([]);
        for (const bad of ["2026-13-01", "мусор", "2026-10-02", undefined]) {
          expect(await sync(bad)).toMatchObject({ status: 422 });
        }
        expect(await sync("2026-10-15")).toEqual({ status: 422, body: { error: "bad_period" } });
        expect(await sync("2026-11-01")).toEqual({ status: 422, body: { error: "period_not_started" } });
        expect(await runsOf(w.les)).toEqual([]);
        expect(enqueued).toEqual([]);

        const r = await sync(P);
        expect(r).toEqual({ status: 202, body: { run_id: expect.any(String), status: "running" } });
        expect(await rawRun(r.body.run_id)).toMatchObject({
          organization_id: w.les,
          kind: "attendance",
          period: P,
          status: "running",
          trigger: "manual",
          created_by: hr.userId,
        });
        expect(enqueued).toEqual([r.body.run_id]);
        expect(await sync(P)).toEqual({ status: 409, body: { error: "run_in_progress" } });
      } finally {
        setNow(null);
      }
      expect(factoryCalls).toEqual([]);
    });

    it("quality: отчёт по организации с названиями филиалов; кривой месяц — 422", async () => {
      reset();
      const w = await world();
      const t = await makeTerminal(db, { organization_id: w.les });
      await addAttendance(db, { terminal_id: t.id, day: "2026-10-05", on_time: 3, late: 0, absent: 1 });
      const r = await api(hr, "GET", `/api/workly/quality?organization_id=${w.les}&period=${P}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        branches: [{ terminal_id: t.id, terminal_name: t.name, days: 4, absent: 1, share: 0.25 }],
        median: 0.25,
        heavy: [],
        employee_names: {},
      });
      expect(await api(hr, "GET", `/api/workly/quality?organization_id=${w.les}&period=2026-10`)).toEqual({
        status: 422,
        body: { error: "bad_period" },
      });
      expect(await api(hr, "GET", `/api/workly/quality?organization_id=${w.les}`)).toMatchObject({ status: 422 });
      expect(factoryCalls).toEqual([]);
    });

    // ---------- граница организаций ----------

    it("каждый маршрут с организацией: неподключённая — 404 organization_not_connected, ничего не создано, клиент не вызывается", async () => {
      reset();
      const w = await world();
      clients = { LES: fakeClient(newCompany()), CHOPAR: fakeClient(newCompany()) };
      const t = (await makeTerminal(db, { organization_id: w.other })).id;
      const e = await mkEmp({ terminal_id: t });
      const loc = await mapLocation(w.other, newCompany(), 1, null);
      // Прогон неподключённой организации (например, переименованной после планирования).
      const [foreignRun] = await db
        .insert(workly_sync_runs)
        .values({ organization_id: w.other, kind: "employees", trigger: "manual", status: "planned", plan: { items: [], report: {} } })
        .returning({ id: workly_sync_runs.id });
      setNow(NOW);
      try {
        const cases: [string, string, unknown?][] = [
          ["POST", "/api/workly/sync/plan", { organization_id: w.other }],
          ["POST", "/api/workly/sync/apply", { run_id: foreignRun.id, exclude: [] }],
          ["GET", `/api/workly/employees?organization_id=${w.other}&q=a`],
          ["POST", "/api/workly/sync/link", { organization_id: w.other, employee_id: e, workly_id: 1 }],
          ["GET", `/api/workly/locations?organization_id=${w.other}`],
          ["POST", "/api/workly/locations/refresh", { organization_id: w.other }],
          ["PUT", `/api/workly/locations/${loc}`, { terminal_id: t }],
          ["POST", "/api/workly/attendance/sync", { organization_id: w.other, period: P }],
          ["GET", `/api/workly/quality?organization_id=${w.other}&period=${P}`],
          ["GET", `/api/workly/terminals?organization_id=${w.other}`],
          // Несуществующая организация — так же.
          ["POST", "/api/workly/sync/plan", { organization_id: randomUUID() }],
        ];
        for (const [method, path, body] of cases) {
          const r = await api(hr, method, path, body);
          expect(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBe(
            `${method} ${path} → 404 ${JSON.stringify({ error: "organization_not_connected" })}`
          );
        }
      } finally {
        setNow(null);
      }
      expect(factoryCalls).toEqual([]);
      expect(enqueued).toEqual([]);
      expect((await runsOf(w.other)).map((x) => x.id)).toEqual([foreignRun.id]);
      expect((await rawRun(foreignRun.id)).status).toBe("planned");
      expect((await locationsOf(w.other))[0].terminal_id).toBeNull();
      expect((await emp(e)).workly_id).toBeNull();
    });

    it("организация, которую подключение узнаёт по имени, но не указывает на неё (дубль или выключенная), — 404", async () => {
      reset();
      const w = await world();
      const dup = await makeOrg();
      // Обратное соответствие говорит LES, а подключение LES указывает на другую организацию.
      extraKeys.set(dup, "LES");
      try {
        expect(await plan(hr, dup)).toEqual({ status: 404, body: { error: "organization_not_connected" } });
        expect(await api(hr, "GET", `/api/workly/locations?organization_id=${dup}`)).toEqual({
          status: 404,
          body: { error: "organization_not_connected" },
        });
      } finally {
        extraKeys.delete(dup);
      }
      expect(await runsOf(dup)).toEqual([]);
      expect(await runsOf(w.les)).toEqual([]);
      expect(enqueued).toEqual([]);
    });

    // ---------- секреты ----------

    it("ни одно тело ответа (статус и ошибки) не содержит значений переменных WORKLY_* из env", async () => {
      expect(bodies.length).toBeGreaterThan(50);
      const leaks = bodies.filter((b) => SECRETS.some((s) => b.includes(s)));
      expect(leaks).toEqual([]);
      // Сам статус ещё раз, с выставленными переменными.
      const r = await api(hr, "GET", "/api/workly/status");
      expect(r.status).toBe(200);
      for (const s of SECRETS) expect(JSON.stringify(r.body)).not.toContain(s);
    });
  });
}
