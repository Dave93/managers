import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в workly/http/nightly.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/activity (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/activity.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { cleanupKpi, makeTerminal, setNow, setup } = await import("../../kpi/http/fixtures");
  const { employees, organization, workly_locations, workly_sync_runs } = await import("backend/drizzle/schema");
  const { activityCursorKey, activityFailsKey, activityPendingKey, pollActivity, runActivityPoll } = await import("../activity");
  const { setClientFactory, WorklyError } = await import("../client");
  const { setExpectedCompanyResolver, setOrganizationResolver } = await import("../config");
  const runs = await import("../runs");
  const { and, asc, eq, sql } = await import("drizzle-orm");
  type ConnKey = import("../types").ConnKey;
  type WorklyClient = import("../client").WorklyClient;
  type WorklyEmployee = import("../types").WorklyEmployee;
  type ActivityClient = import("../activity").ActivityClient;
  type ActivityItem = import("../types").ActivityItem;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;

  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 600_000_000 + Math.floor(Math.random() * 100_000_000);

  // 12:00 по Ташкенту 20 октября.
  const NOW = "2026-10-20T07:00:00.000Z";
  const KEYS: ConnKey[] = ["LES", "CHOPAR"];

  // Redis подставной: курсоры лежат в Map, клиенту Workly он не нужен (клиенты подставляет фабрика).
  let store: Map<string, string>;
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    del: async (...keys: string[]) => keys.filter((k) => store.delete(k)).length,
  } as unknown as Redis;

  // ---------- окружение ----------

  const ENV_KEYS = [
    "WORKLY_BASE_URL",
    "WORKLY_ACTIVITY_POLL",
    ...KEYS.flatMap((k) => [`WORKLY_${k}_CLIENT_ID`, `WORKLY_${k}_CLIENT_SECRET`, `WORKLY_${k}_USERNAME`, `WORKLY_${k}_PASSWORD`]),
  ];
  const savedEnv: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const fullEnv = () => {
    process.env.WORKLY_BASE_URL = "https://workly.invalid";
    for (const k of KEYS) {
      process.env[`WORKLY_${k}_CLIENT_ID`] = `wl_test_id_${k}`;
      process.env[`WORKLY_${k}_CLIENT_SECRET`] = `wl_test_secret_${k}`;
      process.env[`WORKLY_${k}_USERNAME`] = `wl_test_user_${k}`;
      process.env[`WORKLY_${k}_PASSWORD`] = `wl_test_pass_${k}`;
    }
    delete process.env.WORKLY_ACTIVITY_POLL;
  };
  const restoreEnv = () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  };

  // ---------- подставной клиент ----------

  type Person = { first_name: string; last_name: string };
  const person = (): Person => ({ first_name: "Тест", last_name: "N" + hex() });
  const wEmp = (id: number, p: Person, loc: number | null): WorklyEmployee => ({
    id,
    first_name: p.first_name,
    last_name: p.last_name,
    patronymic: "",
    tab_number: `T${id}`,
    start_date: "2026-01-01",
    positions: [{ id: 1, title: "Повар" }],
    locations: loc != null ? [{ id: loc, title: `L${loc}` }] : [],
  });

  interface World {
    org: string;
    company: number;
    pName: Person;
    eName: string;
  }
  type Fake = ActivityClient & { calls: string[]; windows: [string, string][]; events: ActivityItem[] };

  // events — то, что отдаёт user-activities; failEvents — сбой запроса действий; failEmployees — сбой обхода сотрудников.
  function fakeClient(w: World, o: { failEvents?: unknown; failEmployees?: unknown; extraNew?: number } = {}): Fake {
    const fake = { calls: [] as string[], windows: [] as [string, string][], events: [] as ActivityItem[] } as Fake;
    const wrap =
      <T>(method: string, value: () => T, fail?: unknown) =>
      async (..._args: unknown[]): Promise<T> => {
        fake.calls.push(method);
        await new Promise((r) => setTimeout(r, 1));
        if (fail) throw fail;
        return value();
      };
    Object.assign(fake, {
      companyId: wrap("companyId", () => w.company),
      employees: wrap(
        "employees",
        () => [wEmp(1, w.pName, 1), ...Array.from({ length: o.extraNew ?? 0 }, (_, i) => wEmp(1000 + i, person(), 1))],
        o.failEmployees
      ),
      dismissed: wrap("dismissed", () => []),
      locations: wrap("locations", () => [{ id: 1, title: "L1" }]),
      t12: wrap("t12", () => []),
      lateIn: wrap("lateIn", () => []),
      absence: wrap("absence", () => []),
      userActivities: async (from: string, to: string) => {
        fake.calls.push("userActivities");
        fake.windows.push([from, to]);
        if (o.failEvents) throw o.failEvents;
        return fake.events;
      },
    });
    return fake;
  }

  async function makeWorld(): Promise<World> {
    const [o] = await db.insert(organization).values({ name: `wl_test_activity_${hex()}` }).returning({ id: organization.id });
    const company = newCompany();
    const terminal = (await makeTerminal(db, { organization_id: o.id })).id;
    await db.insert(workly_locations).values({
      organization_id: o.id,
      workly_company_id: company,
      workly_location_id: 1,
      title: "L1",
      terminal_id: terminal,
    });
    const pName = person();
    const [a] = await db
      .insert(employees)
      .values({ first_name: pName.first_name, last_name: pName.last_name, terminal_id: terminal })
      .returning({ id: employees.id });
    return { org: o.id, company, pName, eName: a.id };
  }

  let worlds: Record<ConnKey, World>;
  let clients: Partial<Record<ConnKey, Fake>>;

  // Применённый прогон сотрудников: без него ночная сверка и опрос действий не запускаются (первый прогон ручной).
  const insertRun = async (org: string, o: { status: string; trigger?: string; active_fetched?: number; ageHours?: number }) => {
    const plan =
      o.status === "applied"
        ? { items: [], report: { ambiguous: [], not_found: [], no_branch: [] }, applied: ["seed:applied"], skipped: [] }
        : null;
    const [row] = await db
      .insert(workly_sync_runs)
      .values({
        organization_id: org,
        kind: "employees",
        trigger: o.trigger ?? "manual",
        status: o.status,
        active_fetched: o.active_fetched ?? 1,
        plan,
        applied_at: o.status === "applied" ? sql`now()` : null,
        created_at: sql`now() - make_interval(hours => ${o.ageHours ?? 0})`,
      })
      .returning({ id: workly_sync_runs.id });
    return row.id;
  };

  const runsOf = async (org: string) =>
    db
      .select()
      .from(workly_sync_runs)
      .where(and(eq(workly_sync_runs.organization_id, org), eq(workly_sync_runs.kind, "employees")))
      .orderBy(asc(workly_sync_runs.created_at));
  const cursorOf = (key: ConnKey) => store.get(activityCursorKey(key)) ?? null;
  const pendingOf = (key: ConnKey) => store.get(activityPendingKey(key)) ?? null;
  const failsOf = (key: ConnKey) => store.get(activityFailsKey(key)) ?? null;
  // Нужное событие уже видели прошлым опросом (маркер ожидания), поэтому этот опрос запустит сверку.
  const settled = (key: ConnKey, id: number) => store.set(activityPendingKey(key), String(id));

  async function capture<T>(f: () => Promise<T>): Promise<{ value: T; out: string }> {
    const lines: string[] = [];
    const push = (...a: unknown[]) => {
      lines.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    };
    const spies = (["error", "warn", "log", "info"] as const).map((m) => spyOn(console, m).mockImplementation(push));
    try {
      return { value: await f(), out: lines.join("\n") };
    } finally {
      for (const s of spies) s.mockRestore();
    }
  }

  const ev = (id: number, action_name: string): ActivityItem => ({ id, action_name });
  const orgOf = (k: ConnKey) => ({ id: worlds[k].org, key: k });
  const poll = (k: ConnKey) => capture(() => pollActivity(db, redis, orgOf(k), (key) => clients[key]! as ActivityClient));
  const pollAll = () => capture(() => runActivityPoll(db, redis));

  describe("workly: опрос действий пользователей (pollActivity, runActivityPoll)", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      runs.setConnKeyResolver(async (_db, orgId) => KEYS.find((k) => worlds[k].org === orgId) ?? null);
      setClientFactory(((key: ConnKey) => {
        const c = clients[key];
        if (!c) throw new Error("в тесте нет подставного клиента");
        return c as unknown as WorklyClient;
      }) as unknown as Parameters<typeof setClientFactory>[0]);
      setExpectedCompanyResolver(() => null);
      setNow(NOW);
    }, 180000);

    beforeEach(async () => {
      fullEnv();
      setNow(NOW);
      store = new Map();
      worlds = { LES: await makeWorld(), CHOPAR: await makeWorld() };
      clients = { LES: fakeClient(worlds.LES), CHOPAR: fakeClient(worlds.CHOPAR) };
      setOrganizationResolver(async (_db, key) => worlds[key].org);
    });

    afterAll(async () => {
      setNow(null);
      setClientFactory(null);
      setOrganizationResolver(null);
      setExpectedCompanyResolver(null);
      runs.setConnKeyResolver(null);
      restoreEnv();
      await cleanupKpi(db);
    });

    // ---------- курсор ----------

    it("первый опрос: курсор встаёт на максимальный id, сверка не запускается, даже если событие нужное", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      clients.LES!.events = [ev(50, "dismissEmployee"), ev(49, "clockInManual")];
      const { value } = await poll("LES");
      expect(value).toBe("init");
      expect(cursorOf("LES")).toBe("50");
      expect(await runsOf(worlds.LES.org)).toHaveLength(1); // только применённый прогон из подготовки
      expect(clients.LES!.calls).toEqual(["userActivities"]);
    });

    it("окно запроса — со вчерашнего по завтрашний день по Ташкенту", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      await poll("LES");
      expect(clients.LES!.windows).toEqual([["2026-10-19", "2026-10-21"]]);
    });

    it("новые события только ненужных видов: сверки нет, курсор вперёд", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(53, "clockOutManual"), ev(52, "assignedRole"), ev(50, "dismissEmployee")];
      const { value } = await poll("LES");
      expect(value).toBe("idle");
      expect(cursorOf("LES")).toBe("53");
      expect(await runsOf(worlds.LES.org)).toHaveLength(1);
      expect(clients.LES!.calls).toEqual(["userActivities"]);
    });

    // ---------- ожидание: правки HR идут в Workly по шагам ----------

    it("первое нужное событие: settling — сверки нет, курсор прежний, маркер на id самого нового нужного (ненужные новее маркер не двигают)", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(54, "clockInManual"), ev(52, "assignedLocation"), ev(51, "addEmployee")];
      const { value } = await poll("LES");
      expect(value).toBe("settling");
      expect(cursorOf("LES")).toBe("50");
      expect(pendingOf("LES")).toBe("52");
      expect((await runsOf(worlds.LES.org)).filter((r) => r.trigger === "activity")).toHaveLength(0);
      expect(clients.LES!.calls).toEqual(["userActivities"]);
    });

    it("следующий опрос с теми же событиями запускает сверку; курсор вперёд, маркер снят; ещё один опрос — idle", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(53, "clockInManual"), ev(52, "assignedLocation"), ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("settling");
      expect((await poll("LES")).value).toBe("applied");
      const row = (await runsOf(worlds.LES.org)).find((r) => r.trigger === "activity");
      expect(row).toMatchObject({ trigger: "activity", status: "applied" });
      // Связь по имени, как и ночью, ждёт человека.
      const plan = row!.plan as { applied: string[]; skipped: unknown[] };
      expect(plan.applied).not.toContain(`link:${worlds.LES.eName}`);
      expect(cursorOf("LES")).toBe("53");
      expect(pendingOf("LES")).toBeNull();
      expect((await poll("LES")).value).toBe("idle");
      expect((await runsOf(worlds.LES.org)).filter((r) => r.trigger === "activity")).toHaveLength(1);
    });

    it("между опросами пришло ещё одно нужное событие (вторая половина перевода сотрудника): снова settling, маркер на новом id, сверка только после тишины", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(51, "dismissEmployee")];
      expect((await poll("LES")).value).toBe("settling");
      clients.LES!.events = [ev(53, "addEmployee"), ev(51, "dismissEmployee")];
      expect((await poll("LES")).value).toBe("settling");
      expect(pendingOf("LES")).toBe("53");
      expect(cursorOf("LES")).toBe("50");
      expect((await runsOf(worlds.LES.org)).filter((r) => r.trigger === "activity")).toHaveLength(0);
      expect((await poll("LES")).value).toBe("applied");
      expect(cursorOf("LES")).toBe("53");
    });

    // ---------- итоги сверки и курсор ----------

    it("предохранитель too_many_creations: blocked, повторять нечего — курсор вперёд, маркер снят", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      clients.LES = fakeClient(worlds.LES, { extraNew: 51 });
      clients.LES.events = [ev(51, "addEmployee")];
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      const { value } = await poll("LES");
      expect(value).toBe("blocked");
      const row = (await runsOf(worlds.LES.org)).find((r) => r.trigger === "activity");
      expect(row).toMatchObject({ status: "blocked", block_reason: "too_many_creations" });
      expect(cursorOf("LES")).toBe("51");
      expect(pendingOf("LES")).toBeNull();
      expect(failsOf("LES")).toBeNull();
    });

    it("обход сотрудников упал: курсор стоит и сверка повторяется на следующих опросах; третья неудача подряд — курсор вперёд, в логе только код", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      clients.LES = fakeClient(worlds.LES, { failEmployees: new WorklyError("http_error", "секрет внутри") });
      clients.LES.events = [ev(51, "addEmployee")];
      settled("LES", 51);

      const a = await poll("LES");
      expect(a.value).toBe("failed");
      expect(cursorOf("LES")).toBe("50");
      expect(failsOf("LES")).toBe("1");
      expect(pendingOf("LES")).toBe("51");
      expect((await poll("LES")).value).toBe("failed");
      expect(cursorOf("LES")).toBe("50");
      expect(failsOf("LES")).toBe("2");

      const c = await poll("LES");
      expect(c.value).toBe("failed");
      expect(cursorOf("LES")).toBe("51");
      expect(failsOf("LES")).toBeNull();
      expect(pendingOf("LES")).toBeNull();

      const rows = (await runsOf(worlds.LES.org)).filter((r) => r.trigger === "activity");
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toMatchObject({ status: "failed", error: "http_error" });
      for (const o of [a.out, c.out]) expect(o).not.toContain("секрет внутри");
      // Четвёртого опроса с теми же событиями уже нет: курсор прошёл.
      expect((await poll("LES")).value).toBe("idle");
    });

    it("обход короче прошлого (crawl_short) считается сбоем обхода: повтор, а не остановка; успех сбрасывает счётчик", async () => {
      await insertRun(worlds.LES.org, { status: "applied", active_fetched: 100 });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(51, "dismissEmployee")];
      settled("LES", 51);
      expect((await poll("LES")).value).toBe("blocked");
      expect(cursorOf("LES")).toBe("50");
      expect(failsOf("LES")).toBe("1");
      // Workly отдал полный список: тот же опрос доходит до применения.
      await db.update(workly_sync_runs).set({ active_fetched: 1 }).where(and(eq(workly_sync_runs.organization_id, worlds.LES.org), eq(workly_sync_runs.status, "applied")));
      expect((await poll("LES")).value).toBe("applied");
      expect(cursorOf("LES")).toBe("51");
      expect(failsOf("LES")).toBeNull();
    });

    it("запрос действий упал: error, курсор, маркер и журнал не тронуты, в логе только код", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES = fakeClient(worlds.LES, { failEvents: new WorklyError("auth_failed", "секрет внутри") });
      const { value, out } = await poll("LES");
      expect(value).toBe("error");
      expect(cursorOf("LES")).toBe("50");
      expect(pendingOf("LES")).toBe("51");
      expect(await runsOf(worlds.LES.org)).toHaveLength(1);
      expect(out).toContain("auth_failed");
      expect(out).not.toContain("секрет внутри");
    });

    it("уже идёт другой прогон (running): busy, курсор прежний, нового прогона нет", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      await insertRun(worlds.LES.org, { status: "running", trigger: "manual" });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      const { value } = await poll("LES");
      expect(value).toBe("busy");
      expect(cursorOf("LES")).toBe("50");
      expect(pendingOf("LES")).toBe("51");
      expect((await runsOf(worlds.LES.org)).filter((r) => r.trigger === "activity")).toHaveLength(0);
      expect(clients.LES!.calls).toEqual(["userActivities"]);
    });

    // ---------- ручной план HR ----------

    it("свежий план HR, ждущий применения (planned, manual): hold, курсор прежний, чужой план не вытесняется", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 5 });
      const planned = await insertRun(worlds.LES.org, { status: "planned", trigger: "manual", ageHours: 1 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      const { value } = await poll("LES");
      expect(value).toBe("hold");
      expect(cursorOf("LES")).toBe("50");
      const rows = await runsOf(worlds.LES.org);
      expect(rows.filter((r) => r.trigger === "activity")).toHaveLength(0);
      expect(rows.find((r) => r.id === planned)!.status).toBe("planned");
    });

    it("заблокированный прогон не держит опрос: применить blocked нельзя (applyRun берёт только planned), вытеснять там нечего", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 5 });
      await insertRun(worlds.LES.org, { status: "blocked", trigger: "schedule", ageHours: 2 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("applied");
      expect(cursorOf("LES")).toBe("51");
    });

    it("брошенный planned автоматического прогона (не план HR) не держит опрос", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 5 });
      await insertRun(worlds.LES.org, { status: "planned", trigger: "activity", ageHours: 1 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("applied");
    });

    it("брошенная строка running не прячет за собой план HR: опрос смотрит на последний завершённый прогон и ждёт", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 9 });
      await insertRun(worlds.LES.org, { status: "planned", trigger: "manual", ageHours: 2 });
      await insertRun(worlds.LES.org, { status: "running", trigger: "manual", ageHours: 1 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("hold");
      expect(cursorOf("LES")).toBe("50");
    });

    it("план HR держит только сверку: если нужных событий нет, опрос идёт как обычно (idle), курсор вперёд", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 5 });
      await insertRun(worlds.LES.org, { status: "planned", trigger: "manual", ageHours: 1 });
      store.set(activityCursorKey("LES"), "50");
      clients.LES!.events = [ev(51, "clockInManual")];
      expect((await poll("LES")).value).toBe("idle");
      expect(cursorOf("LES")).toBe("51");
    });

    it("план HR старше шести часов не держит опрос", async () => {
      await insertRun(worlds.LES.org, { status: "applied", ageHours: 30 });
      await insertRun(worlds.LES.org, { status: "planned", trigger: "manual", ageHours: 7 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("applied");
      expect(cursorOf("LES")).toBe("51");
    });

    it("после применения плана HR (последний прогон applied) опрос идёт без задержки", async () => {
      await insertRun(worlds.LES.org, { status: "planned", trigger: "manual", ageHours: 3 });
      await insertRun(worlds.LES.org, { status: "applied", trigger: "manual", ageHours: 1 });
      store.set(activityCursorKey("LES"), "50");
      settled("LES", 51);
      clients.LES!.events = [ev(51, "addEmployee")];
      expect((await poll("LES")).value).toBe("applied");
    });

    // ---------- runActivityPoll ----------

    it("выключатель WORKLY_ACTIVITY_POLL=0: ни одного запроса, обе организации disabled", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      process.env.WORKLY_ACTIVITY_POLL = "0";
      const { value } = await pollAll();
      expect(value).toEqual([
        { key: "LES", status: "disabled" },
        { key: "CHOPAR", status: "disabled" },
      ]);
      for (const k of KEYS) expect(clients[k]!.calls).toEqual([]);
      expect(store.size).toBe(0);
    });

    it("подключение без применённого прогона пропускается (первый прогон ручной), второе опрашивается", async () => {
      await insertRun(worlds.CHOPAR.org, { status: "applied" });
      clients.CHOPAR!.events = [ev(7, "addEmployee")];
      const { value } = await pollAll();
      expect(value).toEqual([
        { key: "LES", status: "skipped" },
        { key: "CHOPAR", status: "init" },
      ]);
      expect(clients.LES!.calls).toEqual([]);
      expect(cursorOf("CHOPAR")).toBe("7");
    });

    it("не настроено, но прогон был: skipped и одна строка в логе, без записи в журнал", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      delete process.env.WORKLY_LES_PASSWORD;
      const { value, out } = await pollAll();
      expect(value[0]).toEqual({ key: "LES", status: "skipped" });
      expect(out).toContain("workly activity LES not_configured");
      expect(await runsOf(worlds.LES.org)).toHaveLength(1);
    });

    it("организация не найдена: skipped, запросов нет", async () => {
      setOrganizationResolver(async (_db, key) => (key === "LES" ? null : worlds[key].org));
      await insertRun(worlds.CHOPAR.org, { status: "applied" });
      const { value, out } = await pollAll();
      expect(value[0]).toEqual({ key: "LES", status: "skipped" });
      expect(out).toContain("workly activity LES organization_missing");
      expect(clients.LES!.calls).toEqual([]);
    });

    it("сбой одного подключения не мешает другому; обход идёт по порядку LES, CHOPAR", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      clients.LES = fakeClient(worlds.LES, { failEvents: new WorklyError("http_error", "x") });
      store.set(activityCursorKey("CHOPAR"), "5");
      settled("CHOPAR", 6);
      clients.CHOPAR!.events = [ev(6, "dismissEmployee")];
      const { value } = await pollAll();
      expect(value).toEqual([
        { key: "LES", status: "error" },
        { key: "CHOPAR", status: "applied" },
      ]);
    });
  });
}
