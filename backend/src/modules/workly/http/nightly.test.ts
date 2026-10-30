import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в workly/http/runs.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/nightly (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/nightly.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { cleanupKpi, makeTerminal, setNow, setup } = await import("../../kpi/http/fixtures");
  const { employees, kpi_attendance_imports, kpi_periods, organization, workly_locations, workly_sync_runs } = await import(
    "backend/drizzle/schema"
  );
  const { setClientFactory } = await import("../client");
  const { setOrganizationResolver } = await import("../config");
  const { runNightly } = await import("../nightly");
  const runs = await import("../runs");
  const { and, asc, eq, sql } = await import("drizzle-orm");
  type WorklyClient = import("../client").WorklyClient;
  type RunClient = import("../runs").RunClient;
  type ConnKey = import("../types").ConnKey;
  type WorklyEmployee = import("../types").WorklyEmployee;
  type T12Item = import("../types").T12Item;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;
  // Redis клиенту не нужен: клиенты подставляет фабрика.
  const redis = {} as unknown as Redis;

  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 600_000_000 + Math.floor(Math.random() * 100_000_000);

  // 12:00 по Ташкенту 20 октября: окно октября — с 1-го по 19-е, сентябрь целиком.
  const NOW = "2026-10-20T07:00:00.000Z";
  const CUR = "2026-10-01";
  const PREV = "2026-09-01";
  const KEYS: ConnKey[] = ["LES", "CHOPAR"];

  // ---------- окружение ----------

  const ENV_KEYS = [
    "WORKLY_BASE_URL",
    ...KEYS.flatMap((k) => [`WORKLY_${k}_CLIENT_ID`, `WORKLY_${k}_CLIENT_SECRET`, `WORKLY_${k}_USERNAME`, `WORKLY_${k}_PASSWORD`]),
    "WORKLY_ATTENDANCE_NIGHTLY",
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
    delete process.env.WORKLY_ATTENDANCE_NIGHTLY;
  };
  const restoreEnv = () => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  };

  // ---------- подставной клиент ----------

  type Person = { first_name: string; last_name: string };
  // Имя «Тест …»: cleanupKpi удаляет таких сотрудников.
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

  const t12 = (employee_id: number, days: string[]): T12Item => ({
    employee_id,
    report: { days: days.map((d) => ({ report_date: d, is_work_day: true, is_holiday: false, work_time: "08:00" })) },
  });
  const DAYS = ["2026-09-01", "2026-09-02", "2026-10-01", "2026-10-02"];

  type Fake = RunClient & { calls: string[] };

  // Фиксированные ответы; fail подменяет один метод исключением.
  function fakeClient(w: World, o: { fail?: { method: string; error: unknown }; emptyT12?: boolean; fetched?: WorklyEmployee[] } = {}): Fake {
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
      companyId: wrap("companyId", () => w.company),
      employees: wrap("employees", () => o.fetched ?? [wEmp(1, w.pName, 1), wEmp(2, w.pLinked, 1)]),
      dismissed: wrap("dismissed", () => []),
      locations: wrap("locations", () => [{ id: 1, title: "L1" }]),
      t12: wrap("t12", () => (o.emptyT12 ? [] : [t12(2, DAYS)])),
      lateIn: wrap("lateIn", () => []),
      absence: wrap("absence", () => []),
    });
    return fake;
  }

  // ---------- данные ----------

  // Организация подключения: филиал с локацией 1, сотрудник pName (без связи, тёзка записи 1 в Workly)
  // и сотрудник pLinked (связан с записью 2: только он попадает в посещаемость).
  interface World {
    org: string;
    company: number;
    terminal: string;
    pName: Person;
    pLinked: Person;
    eName: string;
    eLinked: string;
  }

  async function makeWorld(): Promise<World> {
    const [o] = await db.insert(organization).values({ name: `wl_test_nightly_${hex()}` }).returning({ id: organization.id });
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
    const pLinked = person();
    const [a] = await db
      .insert(employees)
      .values({ first_name: pName.first_name, last_name: pName.last_name, terminal_id: terminal })
      .returning({ id: employees.id });
    const [b] = await db
      .insert(employees)
      .values({
        first_name: pLinked.first_name,
        last_name: pLinked.last_name,
        terminal_id: terminal,
        workly_company_id: company,
        workly_id: 2,
        workly_tab_number: "T2",
        position: "Повар",
      })
      .returning({ id: employees.id });
    return { org: o.id, company, terminal, pName, pLinked, eName: a.id, eLinked: b.id };
  }

  let worlds: Record<ConnKey, World>;
  let clients: Partial<Record<ConnKey, Fake>>;

  // Применённый прогон сотрудников: без него ночная сверка не запускается (первый прогон ручной).
  const insertRun = async (org: string, o: { status: string; kind?: string; active_fetched?: number }) => {
    const [row] = await db
      .insert(workly_sync_runs)
      .values({
        organization_id: org,
        kind: o.kind ?? "employees",
        trigger: "manual",
        status: o.status,
        active_fetched: o.active_fetched ?? 2,
        applied_at: o.status === "applied" ? sql`now()` : null,
      })
      .returning({ id: workly_sync_runs.id });
    return row.id;
  };

  const runsOf = async (org: string, kind: string) =>
    db
      .select()
      .from(workly_sync_runs)
      .where(and(eq(workly_sync_runs.organization_id, org), eq(workly_sync_runs.kind, kind)))
      .orderBy(asc(workly_sync_runs.period), asc(workly_sync_runs.created_at));
  const emp = async (id: string) => (await db.select().from(employees).where(eq(employees.id, id)))[0];

  // Весь вывод в консоль собираем: текст исключений в нём недопустим.
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

  const nightly = () => capture(() => runNightly(db, redis));

  describe("workly: ночной прогон (runNightly)", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      // Тестовые организации названы не как подключения: подставляем и организацию по ключу (в beforeEach,
      // она зависит от мира теста), и ключ по организации.
      runs.setConnKeyResolver(async (_db, orgId) => KEYS.find((k) => worlds[k].org === orgId) ?? null);
      setClientFactory(((key: ConnKey) => {
        const c = clients[key];
        if (!c) throw new Error("в тесте нет подставного клиента");
        return c as unknown as WorklyClient;
      }) as unknown as Parameters<typeof setClientFactory>[0]);
      setNow(NOW);
    }, 180000);

    beforeEach(async () => {
      fullEnv();
      setNow(NOW);
      worlds = { LES: await makeWorld(), CHOPAR: await makeWorld() };
      clients = { LES: fakeClient(worlds.LES), CHOPAR: fakeClient(worlds.CHOPAR) };
      setOrganizationResolver(async (_db, key) => worlds[key].org);
    });

    afterAll(async () => {
      setNow(null);
      setClientFactory(null);
      setOrganizationResolver(null);
      runs.setConnKeyResolver(null);
      restoreEnv();
      await cleanupKpi(db);
    });

    // ---------- сотрудники ----------

    it("(1) без применённого прогона сотрудников сверка не запускается (первый прогон ручной): skipped, ничего не изменилось", async () => {
      await insertRun(worlds.LES.org, { kind: "attendance", status: "applied" });
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "skipped", attendance: "skipped" },
        { key: "CHOPAR", employees: "skipped", attendance: "skipped" },
      ]);
      for (const k of KEYS) {
        expect(await runsOf(worlds[k].org, "employees")).toHaveLength(0);
        expect((await emp(worlds[k].eName)).workly_id).toBeNull();
        expect(clients[k]!.calls).toEqual([]);
      }
      expect(out).not.toContain("not_configured");
    });

    it("(1b) применённый прогон есть, но обход короче прошлого на 10%+ — blocked/crawl_short, сотрудники не изменились", async () => {
      await insertRun(worlds.LES.org, { status: "applied", active_fetched: 100 });
      const { value } = await nightly();
      expect(value[0]).toEqual({ key: "LES", employees: "blocked", attendance: "skipped" });
      const row = (await runsOf(worlds.LES.org, "employees")).find((r) => r.trigger === "schedule");
      expect(row).toMatchObject({ trigger: "schedule", status: "blocked", block_reason: "crawl_short" });
      expect((await emp(worlds.LES.eName)).workly_id).toBeNull();
    });

    it("(2) с применённым прогоном и чистым планом план применяется сам; второе подключение без прогона пропущено", async () => {
      await insertRun(worlds.LES.org, { status: "applied" });
      const { value } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "applied", attendance: "skipped" },
        { key: "CHOPAR", employees: "skipped", attendance: "skipped" },
      ]);
      const row = (await runsOf(worlds.LES.org, "employees")).find((r) => r.trigger === "schedule");
      expect(row).toMatchObject({ trigger: "schedule", status: "applied" });
      const linked = await emp(worlds.LES.eName);
      expect(linked.workly_id).toBe(1);
      expect(linked.workly_company_id).toBe(worlds.LES.company);
      expect((await emp(worlds.CHOPAR.eName)).workly_id).toBeNull();
    });

    it("(2b) оба подключения с применёнными прогонами обрабатываются по порядку LES, CHOPAR", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      const { value } = await nightly();
      expect(value.map((r) => [r.key, r.employees])).toEqual([
        ["LES", "applied"],
        ["CHOPAR", "applied"],
      ]);
    });

    // ---------- сбои ----------

    const SECRET = "СЕКРЕТ-Иванов-Иван-parameters-$1";

    it("(3) сбой клиента одного подключения: журнал failed/crawl_failed, второе подключение работает, текста исключения нигде нет", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      clients.CHOPAR = fakeClient(worlds.CHOPAR, { fail: { method: "companyId", error: new Error(SECRET) } });
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "applied", attendance: "skipped" },
        { key: "CHOPAR", employees: "failed", attendance: "skipped" },
      ]);
      const failed = (await runsOf(worlds.CHOPAR.org, "employees")).find((r) => r.trigger === "schedule")!;
      expect(failed).toMatchObject({ status: "failed", error: "crawl_failed" });
      expect(JSON.stringify(value)).not.toContain(SECRET);
      expect(JSON.stringify(failed)).not.toContain(SECRET);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("Иванов");
      expect((await emp(worlds.LES.eName)).workly_id).toBe(1);
    });

    it("(3b) исключение, вылетевшее из шага подключения, даёт error для него одного; в лог — только ключ и код", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      setOrganizationResolver(async (_db, key) => {
        if (key === "CHOPAR") throw new Error(SECRET);
        return worlds[key].org;
      });
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "applied", attendance: "skipped" },
        { key: "CHOPAR", employees: "error", attendance: "skipped" },
      ]);
      expect(JSON.stringify(value)).not.toContain(SECRET);
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("Иванов");
      expect(out).toContain("workly nightly CHOPAR job_failed");
    });

    it("(3c) ошибка клиента Workly записывается в журнал её кодом (client_invalid)", async () => {
      const { WorklyError } = await import("../client");
      await insertRun(worlds.LES.org, { status: "applied" });
      clients.LES = fakeClient(worlds.LES, { fail: { method: "companyId", error: new WorklyError("client_invalid", `обновите ключи ${SECRET}`) } });
      const { value, out } = await nightly();
      expect(value[0]).toEqual({ key: "LES", employees: "failed", attendance: "skipped" });
      expect((await runsOf(worlds.LES.org, "employees")).find((r) => r.trigger === "schedule")).toMatchObject({
        status: "failed",
        error: "client_invalid",
      });
      expect(out).not.toContain(SECRET);
    });

    it("(3d) ручной прогон уже идёт (run_in_progress): error с кодом, второе подключение работает", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      await insertRun(worlds.LES.org, { status: "running" });
      const { value, out } = await nightly();
      expect(value.map((r) => [r.key, r.employees])).toEqual([
        ["LES", "error"],
        ["CHOPAR", "applied"],
      ]);
      expect(out).toContain("workly nightly LES employees - run_in_progress");
    });

    it("(3e) организации подключения нет: оба шага skipped, в лог organization_missing, второе подключение работает", async () => {
      await insertRun(worlds.CHOPAR.org, { status: "applied" });
      setOrganizationResolver(async (_db, key) => (key === "LES" ? null : worlds[key].org));
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "skipped", attendance: "skipped" },
        { key: "CHOPAR", employees: "applied", attendance: "skipped" },
      ]);
      expect(out).toContain("workly nightly LES organization_missing");
    });

    // ---------- не настроено ----------

    it("(4) подключение не настроено, а применённый прогон есть: строка журнала failed/not_configured, console.error; настроенное работает", async () => {
      for (const k of KEYS) await insertRun(worlds[k].org, { status: "applied" });
      delete process.env.WORKLY_CHOPAR_CLIENT_ID;
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "applied", attendance: "skipped" },
        { key: "CHOPAR", employees: "error", attendance: "skipped" },
      ]);
      const rows = (await runsOf(worlds.CHOPAR.org, "employees")).filter((r) => r.trigger === "schedule");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "failed", error: "not_configured", period: null, created_by: null });
      expect(out).toContain("workly nightly CHOPAR not_configured");
      expect(clients.CHOPAR!.calls).toEqual([]);

      // Строка закрыта сразу: следующая ночь не упирается в run_in_progress и пишет свою.
      const again = await nightly();
      expect(again.value[1]).toEqual({ key: "CHOPAR", employees: "error", attendance: "skipped" });
      expect((await runsOf(worlds.CHOPAR.org, "employees")).filter((r) => r.trigger === "schedule")).toHaveLength(2);
    });

    it("(4b) не настроено при WORKLY_ATTENDANCE_NIGHTLY=1: строка посещаемости failed/not_configured за текущий месяц", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      delete process.env.WORKLY_CHOPAR_PASSWORD;
      const { value, out } = await nightly();
      expect(value[0]).toEqual({ key: "LES", employees: "skipped", attendance: "ok" });
      expect(value[1]).toEqual({ key: "CHOPAR", employees: "skipped", attendance: "error" });
      const rows = await runsOf(worlds.CHOPAR.org, "attendance");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trigger: "schedule", status: "failed", error: "not_configured", period: CUR });
      expect(await runsOf(worlds.CHOPAR.org, "employees")).toHaveLength(0);
      expect(out).toContain("workly nightly CHOPAR not_configured");
    });

    it("(4c) не настроено и ничего не ожидалось: тишина, журнал пуст", async () => {
      for (const k of KEYS) {
        for (const v of ["CLIENT_ID", "CLIENT_SECRET", "USERNAME", "PASSWORD"]) delete process.env[`WORKLY_${k}_${v}`];
      }
      const { value, out } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "skipped", attendance: "skipped" },
        { key: "CHOPAR", employees: "skipped", attendance: "skipped" },
      ]);
      for (const k of KEYS) {
        expect(await runsOf(worlds[k].org, "employees")).toHaveLength(0);
        expect(await runsOf(worlds[k].org, "attendance")).toHaveLength(0);
      }
      expect(out).not.toContain("not_configured");
    });

    // ---------- посещаемость ----------

    it("(5) посещаемость по умолчанию выключена: прогонов attendance нет, клиент не трогается", async () => {
      for (const v of [undefined, "0", "", "true"]) {
        if (v === undefined) delete process.env.WORKLY_ATTENDANCE_NIGHTLY;
        else process.env.WORKLY_ATTENDANCE_NIGHTLY = v;
        const { value } = await nightly();
        expect(value.map((r) => r.attendance)).toEqual(["skipped", "skipped"]);
      }
      for (const k of KEYS) {
        expect(await runsOf(worlds[k].org, "attendance")).toHaveLength(0);
        expect(clients[k]!.calls).toEqual([]);
      }
    });

    it("(5b) WORKLY_ATTENDANCE_NIGHTLY=1: прогон за текущий месяц и за предыдущий (он не закрыт), по очереди, импорт записан", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      const { value } = await nightly();
      expect(value).toEqual([
        { key: "LES", employees: "skipped", attendance: "ok" },
        { key: "CHOPAR", employees: "skipped", attendance: "ok" },
      ]);
      for (const k of KEYS) {
        const rows = await runsOf(worlds[k].org, "attendance");
        expect(rows.map((r) => [r.period, r.status, r.trigger, r.created_by, r.error])).toEqual([
          [PREV, "applied", "schedule", null, null],
          [CUR, "applied", "schedule", null, null],
        ]);
        for (const period of [PREV, CUR]) {
          const imports = await db
            .select()
            .from(kpi_attendance_imports)
            .where(and(eq(kpi_attendance_imports.organization_id, worlds[k].org), eq(kpi_attendance_imports.period, period)));
          expect(imports).toHaveLength(1);
        }
      }
    });

    it("(6) предыдущий месяц закрыт: пропускается без ошибки, текущий выполняется", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      await db.insert(kpi_periods).values({ period: PREV, status: "closed" }).onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });
      try {
        const { value, out } = await nightly();
        expect(value.map((r) => r.attendance)).toEqual(["ok", "ok"]);
        for (const k of KEYS) {
          expect((await runsOf(worlds[k].org, "attendance")).map((r) => [r.period, r.status])).toEqual([[CUR, "applied"]]);
        }
        expect(out).not.toContain("period_closed");
      } finally {
        await db.delete(kpi_periods).where(eq(kpi_periods.period, PREV));
      }
    });

    it("(6b) в текущем месяце ещё нет прошедших дней (1 число, ночь): он пропускается тихо, предыдущий выполняется", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      // 1 октября 00:30 по Ташкенту: вчера ещё сентябрь.
      setNow("2026-09-30T19:30:00.000Z");
      const { value, out } = await nightly();
      expect(value.map((r) => r.attendance)).toEqual(["ok", "ok"]);
      for (const k of KEYS) {
        expect((await runsOf(worlds[k].org, "attendance")).map((r) => [r.period, r.status])).toEqual([[PREV, "applied"]]);
      }
      expect(out).not.toContain("period_not_started");
    });

    it("(6c) пустой T12 (empty_crawl): строка failed, attendance error, второе подключение работает", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      clients.LES = fakeClient(worlds.LES, { emptyT12: true });
      const { value, out } = await nightly();
      expect(value.map((r) => r.attendance)).toEqual(["error", "ok"]);
      const rows = await runsOf(worlds.LES.org, "attendance");
      expect(rows.map((r) => [r.period, r.status, r.error])).toEqual([
        [PREV, "failed", "empty_crawl"],
        [CUR, "failed", "empty_crawl"],
      ]);
      expect(out).toContain("empty_crawl");
    });

    it("(6d) посещаемость и сотрудники вместе: сначала сверка, затем месяцы; идёт строго по очереди", async () => {
      process.env.WORKLY_ATTENDANCE_NIGHTLY = "1";
      await insertRun(worlds.LES.org, { status: "applied" });
      const { value } = await nightly();
      expect(value[0]).toEqual({ key: "LES", employees: "applied", attendance: "ok" });
      // Обходы клиента не перемешиваются: companyId сверки предшествует первому t12.
      const calls = clients.LES!.calls;
      expect(calls.indexOf("dismissed")).toBeLessThan(calls.indexOf("t12"));
      expect(calls.filter((c) => c === "t12")).toHaveLength(2);
    });
  });
}
