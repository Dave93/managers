import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в kpi/http/attendance.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/runs (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/runs.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { cleanupKpi, ensureStaffRole, makeTerminal, setup } = await import("../../kpi/http/fixtures");
  const { employees, kpi_reviews, organization, staff_roles, terminals, workly_locations, workly_sync_runs } = await import(
    "backend/drizzle/schema"
  );
  const { KpiError } = await import("../../kpi/errors");
  const { listEmployeeRows } = await import("../../kpi/employees");
  const { structureFrom } = await import("../../staff_roles/catalog");
  const { WorklyError } = await import("../client");
  const config = await import("../config");
  const runs = await import("../runs");
  const queue = await import("../queue");
  const { asc, eq, inArray, sql } = await import("drizzle-orm");
  type RunClient = import("../runs").RunClient;
  type WorklyEmployee = import("../types").WorklyEmployee;
  type WorklyDismissed = import("../types").WorklyDismissed;
  type SyncPlan = import("../plan").SyncPlan;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;
  // Redis клиенту не нужен: тесты всегда передают свой clientOf.
  const redis = {} as unknown as Redis;

  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 3_000_000 + Math.floor(Math.random() * 100_000_000);
  const P = "2026-10-01";

  // ---------- подставной клиент ----------

  type Person = { first_name: string; last_name: string };
  // Имя «Тест …»: cleanupKpi удаляет таких сотрудников, в том числе созданных прогоном.
  const person = (): Person => ({ first_name: "Тест", last_name: "K" + hex() });

  const wEmp = (id: number, p: Person, o: { loc?: number; title?: string; tab?: string } = {}): WorklyEmployee => ({
    id,
    first_name: p.first_name,
    last_name: p.last_name,
    patronymic: "",
    tab_number: o.tab ?? `T${id}`,
    start_date: "2026-01-01",
    positions: o.title ? [{ id: 1, title: o.title }] : [],
    locations: o.loc != null ? [{ id: o.loc, title: `L${o.loc}` }] : [],
  });
  const wDis = (id: number, p: Person): WorklyDismissed => ({
    id,
    first_name: p.first_name,
    last_name: p.last_name,
    patronymic: "",
    tab_number: `T${id}`,
    start_date: "2025-01-01",
    end_date: "2026-09-30",
  });

  type Fake = RunClient & { calls: string[]; maxInflight: number };

  // Фиксированные списки; fail подменяет один метод исключением. Счётчик inflight
  // ловит параллельные обходы одного клиента (их быть не должно).
  function fakeClient(
    company: number,
    active: WorklyEmployee[],
    dismissed: WorklyDismissed[],
    locations: { id: number; title: string }[],
    fail?: { method: string; error: unknown }
  ): Fake {
    let inflight = 0;
    const fake = { calls: [] as string[], maxInflight: 0 } as Fake;
    const wrap =
      <T>(method: string, value: () => T) =>
      async (..._args: unknown[]): Promise<T> => {
        fake.calls.push(method);
        inflight++;
        fake.maxInflight = Math.max(fake.maxInflight, inflight);
        try {
          await new Promise((r) => setTimeout(r, 1));
          if (fail?.method === method) throw fail.error;
          return value();
        } finally {
          inflight--;
        }
      };
    Object.assign(fake, {
      companyId: wrap("companyId", () => company),
      employees: wrap("employees", () => active),
      dismissed: wrap("dismissed", () => dismissed),
      locations: wrap("locations", () => locations),
      t12: wrap("t12", () => []),
      lateIn: wrap("lateIn", () => []),
      absence: wrap("absence", () => []),
    });
    return fake;
  }

  // ---------- данные ----------

  const makeOrg = async (): Promise<string> => {
    const [row] = await db.insert(organization).values({ name: `wl_test_runs_${hex()}` }).returning({ id: organization.id });
    return row.id;
  };

  const mapLocation = async (org: string, company: number, loc: number, terminal: string | null) => {
    await db.insert(workly_locations).values({
      organization_id: org,
      workly_company_id: company,
      workly_location_id: loc,
      title: `L${loc}`,
      terminal_id: terminal,
    });
  };

  const mkEmp = async (o: {
    p?: Person;
    terminal_id: string;
    position?: string | null;
    active?: boolean;
    link?: { company: number; id: number };
    tab?: string | null;
    role_code?: string;
    grade?: number | null;
    shift?: string | null;
    is_trainee?: boolean | null;
  }): Promise<string> => {
    const p = o.p ?? person();
    const [row] = await db
      .insert(employees)
      .values({
        first_name: p.first_name,
        last_name: p.last_name,
        terminal_id: o.terminal_id,
        position: o.position ?? null,
        active: o.active ?? true,
        workly_company_id: o.link?.company ?? null,
        workly_id: o.link?.id ?? null,
        workly_tab_number: o.tab ?? null,
        staff_role_id: o.role_code ? await ensureStaffRole(db, o.role_code) : null,
        grade: o.grade ?? null,
        shift: o.shift ?? null,
        is_trainee: o.is_trainee ?? null,
      })
      .returning({ id: employees.id });
    return row.id;
  };

  const emp = async (id: string) => (await db.select().from(employees).where(eq(employees.id, id)))[0];
  const snap = async (ids: string[]) =>
    db.select().from(employees).where(inArray(employees.id, ids)).orderBy(asc(employees.id));
  const rawRun = async (id: string) => (await db.select().from(workly_sync_runs).where(eq(workly_sync_runs.id, id)))[0];

  // Правка сохранённого плана в обход построителя: так тест получает пункт, которого
  // построитель не выдаёт (пустой before, нарушение внешнего ключа).
  const tamperPlan = async (runId: string, f: (plan: SyncPlan) => void) => {
    const plan = (await rawRun(runId)).plan as SyncPlan;
    f(plan);
    await db.update(workly_sync_runs).set({ plan }).where(eq(workly_sync_runs.id, runId));
  };
  const itemOf = (plan: SyncPlan, key: string) => {
    const it = plan.items.find((i) => i.key === key);
    if (!it) throw new Error(`нет пункта ${key}`);
    return it;
  };

  let structure: (title: string) => ReturnType<typeof structureFrom>;

  // Организация с одним сотрудником на каждый вид пункта плана:
  //   eLink  — не связан, тёзка w1: link + move (локация w1 ведёт на филиал tB);
  //   eUpd   — связан с w2, в Workly другая должность и табельный: update;
  //   eDeact — связан с w3, w3 в списке уволенных: deactivate;
  //   eReact — связан с w4, у нас неактивен: reactivate;
  //   w5     — в Workly есть, у нас нет, локация с филиалом: create;
  //   eGone  — у нас активен, в Workly нет: отчёт not_found;
  //   w6     — локация без филиала: отчёт no_branch;
  //   w8, w9 — уволенные, у этой организации тёзок и связей нет (нужны тесту «чужая организация»).
  async function buildWorld() {
    const org = await makeOrg();
    const company = newCompany();
    const tA = (await makeTerminal(db, { organization_id: org })).id;
    const tB = (await makeTerminal(db, { organization_id: org })).id;
    await mapLocation(org, company, 1, tA);
    await mapLocation(org, company, 2, tB);
    await mapLocation(org, company, 3, null);

    const p = { link: person(), upd: person(), deact: person(), react: person(), create: person(), gone: person(), noBranch: person(), d8: person(), d9: person() };
    const eLink = await mkEmp({ p: p.link, terminal_id: tA });
    const eUpd = await mkEmp({ p: p.upd, terminal_id: tA, position: "Старая должность", link: { company, id: 2 }, tab: "OLD" });
    const eDeact = await mkEmp({ p: p.deact, terminal_id: tA, link: { company, id: 3 }, tab: "T3" });
    const eReact = await mkEmp({ p: p.react, terminal_id: tA, active: false, link: { company, id: 4 }, tab: "T4" });
    const eGone = await mkEmp({ p: p.gone, terminal_id: tA });

    const active = [
      wEmp(1, p.link, { loc: 2, title: "Повар" }),
      wEmp(2, p.upd, { loc: 1, title: "Кассир" }),
      wEmp(4, p.react, { loc: 1 }),
      wEmp(5, p.create, { loc: 1, title: "Повар" }),
      wEmp(6, p.noBranch, { loc: 3 }),
    ];
    const dismissed = [wDis(3, p.deact), wDis(8, p.d8), wDis(9, p.d9)];
    const locations = [
      { id: 1, title: "L1" },
      { id: 2, title: "L2" },
      { id: 3, title: "L3" },
    ];
    const client = fakeClient(company, active, dismissed, locations);
    const ids = [eLink, eUpd, eDeact, eReact, eGone];
    return { org, company, tA, tB, p, eLink, eUpd, eDeact, eReact, eGone, ids, active, dismissed, locations, client };
  }

  const createdBy = async (company: number, worklyId: number) =>
    (
      await db
        .select()
        .from(employees)
        .where(sql`${employees.workly_company_id} = ${company} AND ${employees.workly_id} = ${worklyId}`)
    )[0];

  // startRun + executeRun с подставным клиентом.
  async function plan(org: string, client: RunClient) {
    const { run_id } = await runs.startRun(db, { id: org, key: "LES" }, "employees", "manual", null);
    await runs.executeRun(db, redis, run_id, () => client);
    return { run_id, run: await runs.getRun(db, run_id) };
  }

  const insertRun = async (org: string, o: { kind?: string; status: string; active_fetched?: number }) => {
    const [row] = await db
      .insert(workly_sync_runs)
      .values({
        organization_id: org,
        kind: o.kind ?? "employees",
        trigger: "manual",
        status: o.status,
        active_fetched: o.active_fetched ?? 0,
        applied_at: o.status === "applied" ? sql`now()` : null,
      })
      .returning({ id: workly_sync_runs.id });
    return row.id;
  };

  // Снимок без updated_at: откат пишет его заново, сравниваются только данные.
  type EmpRow = Awaited<ReturnType<typeof snap>>[number];
  const strip = (rows: EmpRow[]) => rows.map(({ updated_at: _, ...r }) => r);
  // План для сравнения: пункты по ключу (loadOurs читает без ORDER BY) и отчёт.
  const shape = (p: SyncPlan) => ({ items: [...p.items].sort((a, b) => a.key.localeCompare(b.key)), report: p.report });
  const changed = (...keys: string[]) => keys.map((key) => ({ key, reason: "changed_since" as const }));

  // Таблица-ссылка на сотрудника только для теста: откат ищет ссылки по имени колонки
  // (employee_id и *_employee_id в public), поэтому своя таблица равнозначна medical_exams и прочим.
  // Имя уникально (wl_test_refs_<hex>), таблица удаляется в finally; остатки упавших прогонов
  // удаляет beforeAll.
  const REF_PREFIX = "wl_test_refs_";
  const dropRefTables = async () => {
    const r = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE ${"wl\\_test\\_refs\\_%"}`);
    for (const row of r.rows as { tablename: string }[]) {
      await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier("public")}.${sql.identifier(row.tablename)}`);
    }
  };
  async function withRefTable(column: string, type: "uuid" | "text", employeeId: string, fn: () => Promise<void>) {
    const table = REF_PREFIX + hex();
    const t = sql`${sql.identifier("public")}.${sql.identifier(table)}`;
    await db.execute(sql`CREATE TABLE ${t} (id serial PRIMARY KEY, ${sql.identifier(column)} ${sql.raw(type)} NOT NULL)`);
    try {
      await db.execute(sql`INSERT INTO ${t} (${sql.identifier(column)}) VALUES (${employeeId})`);
      await fn();
    } finally {
      await db.execute(sql`DROP TABLE IF EXISTS ${t}`);
    }
  }

  describe("workly: журнал прогонов и применение плана", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      await dropRefTables();
      const roles = await db.select().from(staff_roles);
      structure = (title: string) => structureFrom(roles, { position: title }, false);
      // Тестовые организации названы не как подключения: ключ подключения подставляем.
      runs.setConnKeyResolver(async () => "LES");
      // Подставные клиенты отдают случайные номера компаний: сверка компании выключена,
      // её проверяют отдельные тесты company_mismatch.
      config.setExpectedCompanyResolver(() => null);
    }, 180000);

    afterAll(async () => {
      runs.setConnKeyResolver(null);
      config.setExpectedCompanyResolver(null);
      queue.setRunEnqueuer(null);
      await dropRefTables();
      await cleanupKpi(db);
    });

    // ---------- очередь ----------

    it("очередь: имя из WORKLY_QUEUE при вызове, enqueueRun уходит в подменённую функцию", async () => {
      expect(queue.WORKLY_RUN_JOB).toBe("workly-run");
      expect(queue.worklyQueueName()).toBe("workly_sync_test");
      const saved = process.env.WORKLY_QUEUE;
      delete process.env.WORKLY_QUEUE;
      try {
        expect(queue.worklyQueueName()).toBe("workly-sync");
      } finally {
        process.env.WORKLY_QUEUE = saved;
      }
      expect(queue.getWorklyQueue().name).toBe("workly_sync_test");
      const got: string[] = [];
      queue.setRunEnqueuer(async (id) => {
        got.push(id);
      });
      await queue.enqueueRun("run-1");
      expect(got).toEqual(["run-1"]);
      queue.setRunEnqueuer(null);
    });

    // ---------- startRun ----------

    it("startRun пишет строку running; второй той же организации и вида — run_in_progress; другой вид и другая организация допускаются", async () => {
      const org = await makeOrg();
      const org2 = await makeOrg();
      const user = randomUUID();
      const a = await runs.startRun(db, { id: org, key: "LES" }, "employees", "manual", user);
      expect(await runs.getRun(db, a.run_id)).toMatchObject({
        id: a.run_id,
        organization_id: org,
        kind: "employees",
        trigger: "manual",
        status: "running",
        block_reason: null,
        plan: null,
        error: null,
        period: null,
        applied_at: null,
      });
      expect((await rawRun(a.run_id)).created_by).toBe(user);

      const err = await runs.startRun(db, { id: org, key: "LES" }, "employees", "schedule", null).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 409, code: "run_in_progress" });

      const b = await runs.startRun(db, { id: org, key: "LES" }, "attendance", "schedule", null, P);
      expect(await runs.getRun(db, b.run_id)).toMatchObject({ kind: "attendance", trigger: "schedule", status: "running", period: P });
      const c = await runs.startRun(db, { id: org2, key: "CHOPAR" }, "employees", "manual", null);
      expect((await runs.getRun(db, c.run_id)).status).toBe("running");
    });

    it("startRun закрывает зависшую строку (старше 15 минут) как failed/stale; свежую и чужие не трогает", async () => {
      const org = await makeOrg();
      const insertRunning = async (organization_id: string, kind: string, minutesAgo: number) => {
        const [row] = await db
          .insert(workly_sync_runs)
          .values({
            organization_id,
            kind,
            trigger: "manual",
            status: "running",
            created_at: sql`now() - make_interval(mins => ${minutesAgo})`,
          })
          .returning({ id: workly_sync_runs.id });
        return row.id;
      };
      const old = await insertRunning(org, "employees", 20);
      const otherKind = await insertRunning(org, "attendance", 20);
      const { run_id } = await runs.startRun(db, { id: org, key: "LES" }, "employees", "manual", null);
      expect(run_id).not.toBe(old);
      expect(await runs.getRun(db, old)).toMatchObject({ status: "failed", error: "stale" });
      expect((await runs.getRun(db, run_id)).status).toBe("running");
      expect((await runs.getRun(db, otherKind)).status).toBe("running");

      // Пятиминутная строка не зависшая: новый запуск по-прежнему 409.
      const org2 = await makeOrg();
      const fresh = await insertRunning(org2, "employees", 5);
      await expect(runs.startRun(db, { id: org2, key: "LES" }, "employees", "manual", null)).rejects.toMatchObject({
        status: 409,
        code: "run_in_progress",
      });
      expect((await runs.getRun(db, fresh)).status).toBe("running");
    });

    // ---------- executeRun ----------

    it("executeRun пишет planned с counts, компанией и active_fetched и не меняет employees; обходы идут по одному", async () => {
      const w = await buildWorld();
      const before = await snap(w.ids);
      const { run_id, run } = await plan(w.org, w.client);
      expect(run.status).toBe("planned");
      expect(run.error).toBeNull();
      expect(run.counts).toEqual({
        link: 1,
        relink: 0,
        update: 1,
        move: 1,
        create: 1,
        deactivate: 1,
        reactivate: 1,
        ambiguous: 0,
        not_found: 1,
        no_branch: 1,
      });
      expect(run.plan!.items.map((i) => i.key).sort()).toEqual(
        [`link:${w.eLink}`, `move:${w.eLink}`, `update:${w.eUpd}`, `reactivate:${w.eReact}`, "create:w5", `deactivate:${w.eDeact}`].sort()
      );
      expect(run.plan!.report.not_found.map((x) => x.employee_id)).toEqual([w.eGone]);
      expect(run.plan!.report.no_branch.map((x) => x.workly_id)).toEqual([6]);
      expect(run.plan!.applied).toBeUndefined();
      expect(run.plan!.skipped).toBeUndefined();
      // before пункта link хранит текущее значение каждого поля, которое пункт меняет.
      expect(run.plan!.items.find((i) => i.key === `link:${w.eLink}`)!.before).toEqual({
        workly_id: null,
        workly_company_id: null,
        workly_tab_number: null,
        position: null,
        staff_role_id: null,
        grade: null,
        shift: null,
        is_trainee: null,
        active: true,
      });
      const raw = await rawRun(run_id);
      expect(raw.workly_company_id).toBe(w.company);
      expect(raw.active_fetched).toBe(5);
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
      // Локации обновлены до обхода сотрудников, клиенту ни разу не пришлось работать параллельно.
      expect(w.client.calls.slice(0, 2)).toEqual(["companyId", "locations"]);
      expect(w.client.calls).toContain("employees");
      expect(w.client.calls).toContain("dismissed");
      expect(w.client.maxInflight).toBe(1);
    });

    it("в план попадают только сотрудники своей организации: тёзка из другой организации не связывается и не деактивируется", async () => {
      const w = await buildWorld();
      const orgB = await makeOrg();
      const tOther = (await makeTerminal(db, { organization_id: orgB })).id;
      // Тёзка eLink: будь он в выборке, w1 стал бы неоднозначным.
      const b1 = await mkEmp({ p: w.p.link, terminal_id: tOther });
      // Тёзка уволенной записи w8: будь он в выборке, ушёл бы в деактивацию по имени.
      const b2 = await mkEmp({ p: w.p.d8, terminal_id: tOther });
      // Связан с уволенной записью w9 той же компании.
      const b3 = await mkEmp({ p: w.p.d9, terminal_id: tOther, link: { company: w.company, id: 9 } });
      const bBefore = await snap([b1, b2, b3]);

      const { run_id, run } = await plan(w.org, w.client);
      const touched = new Set(run.plan!.items.map((i) => i.employee_id));
      for (const b of [b1, b2, b3]) expect(touched.has(b)).toBe(false);
      expect(run.plan!.items.find((i) => i.key === `link:${w.eLink}`)).toBeDefined();
      expect(run.plan!.report.ambiguous).toEqual([]);
      expect(run.plan!.report.not_found.map((x) => x.employee_id)).toEqual([w.eGone]);

      await runs.applyRun(db, run_id, [], null);
      expect(await snap([b1, b2, b3])).toEqual(bBefore);
      expect((await emp(w.eLink)).workly_id).toBe(1);
    });

    it("сбой клиента: WorklyError даёт его код, прочее — crawl_failed без текста исключения в строке и в логе", async () => {
      const w = await buildWorld();
      const before = await snap(w.ids);
      const logged: string[] = [];
      const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
      });
      try {
        const invalid = fakeClient(w.company, w.active, w.dismissed, w.locations, {
          method: "companyId",
          error: new WorklyError("client_invalid", "Workly отклонил client_id/client_secret (код 7003)"),
        });
        const r1 = await runs.startRun(db, { id: w.org, key: "LES" }, "employees", "manual", null);
        await runs.executeRun(db, redis, r1.run_id, () => invalid);
        expect(await runs.getRun(db, r1.run_id)).toMatchObject({ status: "failed", error: "client_invalid", plan: null });

        const boom = fakeClient(w.company, w.active, w.dismissed, w.locations, {
          method: "employees",
          error: new Error("boom secret-xyz"),
        });
        const r2 = await runs.startRun(db, { id: w.org, key: "LES" }, "employees", "manual", null);
        await runs.executeRun(db, redis, r2.run_id, () => boom);
        const row = await runs.getRun(db, r2.run_id);
        expect(row).toMatchObject({ status: "failed", error: "crawl_failed", plan: null });
        expect(JSON.stringify(row)).not.toContain("secret-xyz");
        expect(JSON.stringify(await rawRun(r2.run_id))).not.toContain("secret-xyz");
        // Компания узнана до сбоя и записана.
        expect((await rawRun(r2.run_id)).workly_company_id).toBe(w.company);

        // Фабрика клиента бросает not_configured (нет переменных WORKLY_*).
        const r3 = await runs.startRun(db, { id: w.org, key: "LES" }, "employees", "manual", null);
        await runs.executeRun(db, redis, r3.run_id, () => {
          throw new WorklyError("not_configured", "Подключение Workly LES не настроено");
        });
        expect(await runs.getRun(db, r3.run_id)).toMatchObject({ status: "failed", error: "not_configured" });
      } finally {
        spy.mockRestore();
      }
      expect(logged.join("\n")).not.toContain("secret-xyz");
      expect(await snap(w.ids)).toEqual(before);
    });

    it("организация без подключения Workly (connKeyOf null) — failed/not_configured, клиент не собирается", async () => {
      const w = await buildWorld();
      runs.setConnKeyResolver(null);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const { run_id } = await runs.startRun(db, { id: w.org, key: "LES" }, "employees", "manual", null);
        let built = false;
        await runs.executeRun(db, redis, run_id, () => {
          built = true;
          return w.client;
        });
        expect(built).toBe(false);
        expect(await runs.getRun(db, run_id)).toMatchObject({ status: "failed", error: "not_configured" });
      } finally {
        spy.mockRestore();
        runs.setConnKeyResolver(async () => "LES");
      }
    });

    it("пустой обход Workly — failed/empty_crawl, плана нет, сотрудники не изменились", async () => {
      const w = await buildWorld();
      const before = await snap(w.ids);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const empty = fakeClient(w.company, [], w.dismissed, w.locations);
        const { run } = await plan(w.org, empty);
        expect(run).toMatchObject({ status: "failed", error: "empty_crawl", plan: null });
      } finally {
        spy.mockRestore();
      }
      expect(await snap(w.ids)).toEqual(before);
    });

    // Учётка другой компании в переменных подключения (спека 5.1): данные чужой компании
    // не должны попасть ни в карту локаций, ни в план.
    const companyWorld = async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const p = person();
      const e = await mkEmp({ p, terminal_id: t, link: { company, id: 1 }, tab: "T1" });
      const active = [wEmp(1, p, { loc: 1, title: "Кассир" }), wEmp(2, person(), { loc: 1 })];
      const locations = [{ id: 1, title: "L1" }];
      return { org, company, t, e, active, locations };
    };
    const locationRows = async (org: string) =>
      db.select().from(workly_locations).where(eq(workly_locations.organization_id, org));

    it("company_mismatch: компания учётки не та, что у подключения — failed до любой записи: ни локаций, ни плана, сотрудники целы", async () => {
      const w = await companyWorld();
      const before = await snap([w.e]);
      const foreign = fakeClient(w.company + 1, w.active, [], w.locations);
      config.setExpectedCompanyResolver((key) => (key === "LES" ? w.company : null));
      const logged: string[] = [];
      const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
        logged.push(a.map(String).join(" "));
      });
      try {
        const { run_id, run } = await plan(w.org, foreign);
        expect(run).toMatchObject({ status: "failed", error: "company_mismatch", plan: null, applied_at: null });
        const raw = await rawRun(run_id);
        expect(raw.workly_company_id).toBeNull();
        expect(raw.active_fetched).toBe(0);
        // После companyId клиент больше не вызывался: ни локаций, ни сотрудников.
        expect(foreign.calls).toEqual(["companyId"]);
      } finally {
        spy.mockRestore();
        config.setExpectedCompanyResolver(() => null);
      }
      expect(await locationRows(w.org)).toEqual([]);
      expect(await snap([w.e])).toEqual(before);
      expect(await createdBy(w.company + 1, 2)).toBeUndefined();
      // В лог — только id прогона и код, номеров компаний там нет.
      expect(logged.join("\n")).toContain("company_mismatch");
      expect(logged.join("\n")).not.toContain(String(w.company + 1));
    });

    it("company_mismatch не мешает своей компании: при совпадении план строится и локации пишутся", async () => {
      const w = await companyWorld();
      const own = fakeClient(w.company, w.active, [], w.locations);
      config.setExpectedCompanyResolver((key) => (key === "LES" ? w.company : null));
      try {
        const { run_id, run } = await plan(w.org, own);
        expect(run).toMatchObject({ status: "planned", error: null });
        expect((await rawRun(run_id)).workly_company_id).toBe(w.company);
      } finally {
        config.setExpectedCompanyResolver(() => null);
      }
      expect((await locationRows(w.org)).map((r) => [r.workly_company_id, r.workly_location_id])).toEqual([[w.company, 1]]);
    });

    it("executeRun по строке не в статусе running ничего не делает", async () => {
      const w = await buildWorld();
      const { run_id, run } = await plan(w.org, w.client);
      const calls = w.client.calls.length;
      await runs.executeRun(db, redis, run_id, () => w.client);
      expect(w.client.calls.length).toBe(calls);
      expect(await runs.getRun(db, run_id)).toEqual(run);
      // Несуществующая строка — тоже без ошибок и без обращения к клиенту.
      await runs.executeRun(db, redis, randomUUID(), () => w.client);
      expect(w.client.calls.length).toBe(calls);
    });

    // ---------- applyRun ----------

    it("applyRun применяет план, пишет applied и id созданного; следующий прогон даёт пустой plan.items", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const updBefore = await emp(w.eUpd);
      const res = await runs.applyRun(db, run_id, [], randomUUID());
      expect(res).toEqual({ applied: 6, skipped: [] });

      const cook = structure("Повар");
      const cashier = structure("Кассир");
      expect(await emp(w.eLink)).toMatchObject({
        workly_company_id: w.company,
        workly_id: 1,
        workly_tab_number: "T1",
        position: cook.position,
        staff_role_id: cook.staff_role_id,
        terminal_id: w.tB,
        active: true,
      });
      const upd = await emp(w.eUpd);
      expect(upd).toMatchObject({ position: cashier.position, staff_role_id: cashier.staff_role_id, workly_tab_number: "T2", terminal_id: w.tA });
      expect(Date.parse(upd.updated_at)).toBeGreaterThan(Date.parse(updBefore.updated_at));
      expect(await emp(w.eDeact)).toMatchObject({ active: false, workly_company_id: w.company, workly_id: 3 });
      expect(await emp(w.eReact)).toMatchObject({ active: true, workly_id: 4 });
      expect(await emp(w.eGone)).toMatchObject({ active: true, workly_id: null });
      const created = await createdBy(w.company, 5);
      expect(created).toMatchObject({
        first_name: w.p.create.first_name,
        last_name: w.p.create.last_name,
        terminal_id: w.tA,
        active: true,
        workly_tab_number: "T5",
        position: cook.position,
        staff_role_id: cook.staff_role_id,
      });
      // w6 без филиала не создан.
      expect(await createdBy(w.company, 6)).toBeUndefined();

      const run = await runs.getRun(db, run_id);
      expect(run.status).toBe("applied");
      expect(run.applied_at).not.toBeNull();
      expect([...run.plan!.applied!].sort()).toEqual(run.plan!.items.map((i) => i.key).sort());
      expect(run.plan!.skipped).toEqual([]);
      expect(run.plan!.items.find((i) => i.kind === "create")!.employee_id).toBe(created.id);

      const again = await plan(w.org, w.client);
      expect(again.run.status).toBe("planned");
      expect(again.run.plan!.items).toEqual([]);
    });

    it("exclude пропускает пункт: skipped с excluded, сотрудник не изменился, в applied ключа нет", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const before = await emp(w.eUpd);
      const key = `update:${w.eUpd}`;
      const res = await runs.applyRun(db, run_id, [key, "нет-такого-ключа"], null);
      expect(res.skipped).toEqual([{ key, reason: "excluded" }]);
      expect(res.applied).toBe(5);
      expect(await emp(w.eUpd)).toEqual(before);
      const run = await runs.getRun(db, run_id);
      expect(run.plan!.applied).not.toContain(key);
      expect(run.plan!.applied).toHaveLength(5);
      expect((await emp(w.eDeact)).active).toBe(false);
    });

    it("stale: изменённый после плана сотрудник пропускается; перенос при устаревшей связи тоже", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await db.update(employees).set({ position: "Изменено вручную" }).where(eq(employees.id, w.eUpd));
      // У eLink в пункте link before.position = null: после правки пункт устарел. Перенос
      // держится на той же связи по имени, поэтому пропускается вместе с ней.
      await db.update(employees).set({ position: "Тоже вручную" }).where(eq(employees.id, w.eLink));

      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([
        { key: `link:${w.eLink}`, reason: "stale" },
        { key: `update:${w.eUpd}`, reason: "stale" },
        { key: `move:${w.eLink}`, reason: "stale" },
      ]);
      expect(res.applied).toBe(3);
      expect(await emp(w.eUpd)).toMatchObject({ position: "Изменено вручную", workly_tab_number: "OLD" });
      expect(await emp(w.eLink)).toMatchObject({ position: "Тоже вручную", workly_id: null, workly_company_id: null, terminal_id: w.tA });
      const run = await runs.getRun(db, run_id);
      expect([...run.plan!.applied!].sort()).toEqual([`reactivate:${w.eReact}`, "create:w5", `deactivate:${w.eDeact}`].sort());
    });

    it("перенос уже связанного сотрудника не зависит от его пункта update", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const tA = (await makeTerminal(db, { organization_id: org })).id;
      const tB = (await makeTerminal(db, { organization_id: org })).id;
      await mapLocation(org, company, 2, tB);
      const p = person();
      const e = await mkEmp({ p, terminal_id: tA, position: "Старая", link: { company, id: 1 }, tab: "T1" });
      const client = fakeClient(company, [wEmp(1, p, { loc: 2, title: "Кассир" })], [], [{ id: 2, title: "L2" }]);
      const { run_id, run } = await plan(org, client);
      expect(run.plan!.items.map((i) => i.key)).toEqual([`update:${e}`, `move:${e}`]);
      await db.update(employees).set({ position: "Вручную" }).where(eq(employees.id, e));
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res).toEqual({ applied: 1, skipped: [{ key: `update:${e}`, reason: "stale" }] });
      expect(await emp(e)).toMatchObject({ position: "Вручную", terminal_id: tB });
    });

    it("исключённая связь по имени исключает и её перенос", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const before = await emp(w.eLink);
      const res = await runs.applyRun(db, run_id, [`link:${w.eLink}`], null);
      expect(res.skipped).toEqual([
        { key: `link:${w.eLink}`, reason: "excluded" },
        { key: `move:${w.eLink}`, reason: "excluded" },
      ]);
      expect(res.applied).toBe(4);
      expect(await emp(w.eLink)).toEqual(before);
    });

    it("stale: сотрудник перешёл в филиал другой организации — пункт пропускается", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const tOther = (await makeTerminal(db, { organization_id: await makeOrg() })).id;
      await db.update(employees).set({ terminal_id: tOther }).where(eq(employees.id, w.eDeact));
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([{ key: `deactivate:${w.eDeact}`, reason: "stale" }]);
      expect((await emp(w.eDeact)).active).toBe(true);
    });

    it("conflict: workly_id уже занят другим сотрудником — пункт в skipped, остальные применены", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      // Связи появились после построения плана (у сотрудников другой организации).
      const orgB = await makeOrg();
      const tOther = (await makeTerminal(db, { organization_id: orgB })).id;
      const h1 = await mkEmp({ terminal_id: tOther, link: { company: w.company, id: 1 } });
      const h5 = await mkEmp({ terminal_id: tOther, link: { company: w.company, id: 5 } });
      const hBefore = await snap([h1, h5]);

      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([
        { key: `link:${w.eLink}`, reason: "conflict" },
        { key: "create:w5", reason: "conflict" },
        { key: `move:${w.eLink}`, reason: "conflict" },
      ]);
      expect(res.applied).toBe(3);
      // Пункт link шёл первым: после отката к точке сохранения остальные применились.
      // Перенос держался на этой связи и пропущен вместе с ней.
      expect(await emp(w.eLink)).toMatchObject({ workly_id: null, terminal_id: w.tA });
      expect((await emp(w.eUpd)).workly_tab_number).toBe("T2");
      expect((await emp(w.eReact)).active).toBe(true);
      expect((await emp(w.eDeact)).active).toBe(false);
      expect(await snap([h1, h5])).toEqual(hBefore);
      const run = await runs.getRun(db, run_id);
      expect(run.status).toBe("applied");
      expect(run.plan!.applied).not.toContain(`link:${w.eLink}`);
      expect(run.plan!.applied).not.toContain("create:w5");
      expect(run.plan!.items.find((i) => i.kind === "create")!.employee_id).toBeNull();
    });

    it("applyRun по applied и по running — run_not_planned; чужой id — run_not_found", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      const e1 = await runs.applyRun(db, run_id, [], null).catch((e) => e);
      expect(e1).toBeInstanceOf(KpiError);
      expect(e1).toMatchObject({ status: 409, code: "run_not_planned" });

      const running = await runs.startRun(db, { id: w.org, key: "LES" }, "employees", "manual", null);
      await expect(runs.applyRun(db, running.run_id, [], null)).rejects.toMatchObject({ status: 409, code: "run_not_planned" });
      expect((await runs.getRun(db, running.run_id)).status).toBe("running");

      await expect(runs.applyRun(db, randomUUID(), [], null)).rejects.toMatchObject({ status: 404, code: "run_not_found" });
      await expect(runs.getRun(db, randomUUID())).rejects.toMatchObject({ status: 404, code: "run_not_found" });
      await expect(runs.getRun(db, "не-uuid")).rejects.toMatchObject({ status: 404, code: "run_not_found" });
    });

    it("два одновременных applyRun: применяет один, второй получает run_not_planned", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const results = await Promise.allSettled([runs.applyRun(db, run_id, [], null), runs.applyRun(db, run_id, [], null)]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const bad = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect(bad[0].reason).toMatchObject({ status: 409, code: "run_not_planned" });
      const run = await runs.getRun(db, run_id);
      expect(run.plan!.applied).toHaveLength(6);
      expect((await db.select().from(employees).where(sql`${employees.workly_company_id} = ${w.company} AND ${employees.workly_id} = 5`)).length).toBe(1);
    });

    // ---------- устаревший план (A) ----------

    it("A: при более новом planned прогоне той же организации и вида — run_superseded, сотрудники не изменились; новый применяется", async () => {
      const w = await buildWorld();
      const a = await plan(w.org, w.client);
      const b = await plan(w.org, w.client);
      const before = await snap(w.ids);
      const err = await runs.applyRun(db, a.run_id, [], null).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 409, code: "run_superseded" });
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
      expect(await runs.getRun(db, a.run_id)).toMatchObject({ status: "planned", applied_at: null });
      expect((await runs.applyRun(db, b.run_id, [], null)).applied).toBe(6);
    });

    it("A: более новые applied и blocked тоже вытесняют план", async () => {
      for (const status of ["applied", "blocked"]) {
        const w = await buildWorld();
        const a = await plan(w.org, w.client);
        await insertRun(w.org, { status });
        await expect(runs.applyRun(db, a.run_id, [], null)).rejects.toMatchObject({ status: 409, code: "run_superseded" });
        expect((await emp(w.eDeact)).active).toBe(true);
      }
    });

    it("A: более новые failed и running не вытесняют план", async () => {
      const w = await buildWorld();
      const a = await plan(w.org, w.client);
      await insertRun(w.org, { status: "failed" });
      await insertRun(w.org, { status: "running" });
      expect((await runs.applyRun(db, a.run_id, [], null)).applied).toBe(6);
    });

    it("A (R29): более новый прогон применён и откатан — старый план по-прежнему run_superseded", async () => {
      const w = await buildWorld();
      const p = await plan(w.org, w.client);
      const b = await plan(w.org, w.client);
      await runs.applyRun(db, b.run_id, [], null);
      await runs.rollbackRun(db, b.run_id);
      expect((await runs.getRun(db, b.run_id)).status).toBe("rolled_back");
      const before = await snap(w.ids);
      const err = await runs.applyRun(db, p.run_id, [], null).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 409, code: "run_superseded" });
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
      expect(await runs.getRun(db, p.run_id)).toMatchObject({ status: "planned", applied_at: null });
    });

    it("A: более новый прогон другой организации или другого вида не вытесняет план", async () => {
      const w = await buildWorld();
      const a = await plan(w.org, w.client);
      const other = await makeOrg();
      await insertRun(other, { status: "planned" });
      await insertRun(other, { status: "applied" });
      await insertRun(w.org, { kind: "attendance", status: "applied" });
      await insertRun(w.org, { kind: "attendance", status: "planned" });
      expect((await runs.applyRun(db, a.run_id, [], null)).applied).toBe(6);
    });

    // ---------- причины пропуска в журнале (C) ----------

    it("C: plan.skipped хранит исключённые и устаревшие пункты с причинами", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await db.update(employees).set({ active: true }).where(eq(employees.id, w.eReact));
      const res = await runs.applyRun(db, run_id, [`update:${w.eUpd}`], null);
      const expected: { key: string; reason: "excluded" | "stale" | "conflict" }[] = [
        { key: `update:${w.eUpd}`, reason: "excluded" },
        { key: `reactivate:${w.eReact}`, reason: "stale" },
      ];
      expect(res.skipped).toEqual(expected);
      const run = await runs.getRun(db, run_id);
      expect(run.plan!.skipped).toEqual(expected);
      expect(run.plan!.applied).not.toContain(`update:${w.eUpd}`);
      expect(run.plan!.applied).not.toContain(`reactivate:${w.eReact}`);
    });

    // ---------- полнота before (D) ----------

    it("D: загрузчик передаёт структуру должности, before пункта update её хранит", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const p = person();
      const e = await mkEmp({ p, terminal_id: t, position: "Повар 2 разряд день", role_code: "cook", grade: 2, shift: "day", is_trainee: false, link: { company, id: 1 }, tab: "T1" });
      const client = fakeClient(company, [wEmp(1, p, { title: "Кассир" })], [], []);
      const { run } = await plan(org, client);
      expect(run.plan!.items.map((i) => i.key)).toEqual([`update:${e}`]);
      expect(run.plan!.items[0].before).toEqual({
        position: "Повар 2 разряд день",
        staff_role_id: (await emp(e)).staff_role_id,
        grade: 2,
        shift: "day",
        is_trainee: false,
        workly_company_id: company,
        workly_id: 1,
      });
    });

    it("D: роль, изменённая вручную после плана, делает пункт update устаревшим", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      const role = await ensureStaffRole(db, "cook");
      await db.update(employees).set({ staff_role_id: role }).where(eq(employees.id, w.eUpd));
      const before = await emp(w.eUpd);
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([{ key: `update:${w.eUpd}`, reason: "stale" }]);
      expect(await emp(w.eUpd)).toEqual(before);
    });

    it("D: перепривязка сотрудника к другой записи Workly после плана делает его update устаревшим", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await db.update(employees).set({ workly_id: 200 }).where(eq(employees.id, w.eUpd));
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([{ key: `update:${w.eUpd}`, reason: "stale" }]);
      expect((await emp(w.eUpd)).position).toBe("Старая должность");
    });

    it("D: пункт с пустым before или с before без поля из after не применяется (stale)", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await tamperPlan(run_id, (p) => {
        itemOf(p, `update:${w.eUpd}`).before = {};
        delete itemOf(p, `reactivate:${w.eReact}`).before!.active;
      });
      const upd = await emp(w.eUpd);
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.skipped).toEqual([
        { key: `update:${w.eUpd}`, reason: "stale" },
        { key: `reactivate:${w.eReact}`, reason: "stale" },
      ]);
      expect(await emp(w.eUpd)).toEqual(upd);
      expect((await emp(w.eReact)).active).toBe(false);
    });

    // ---------- страховки применения (E) ----------

    it("E: ошибка пункта, отличная от конфликта, откатывает всё применение: прогон planned, никто не изменился", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      // Последний основной пункт (deactivate) ссылается на несуществующую роль: внешний ключ.
      await tamperPlan(run_id, (p) => {
        const it = itemOf(p, `deactivate:${w.eDeact}`);
        it.after.staff_role_id = randomUUID();
        it.before!.staff_role_id = null;
      });
      const before = await snap(w.ids);
      const err = await runs.applyRun(db, run_id, [], null).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(KpiError);
      // Пункты link, update, reactivate и create шли раньше и тоже откатились.
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
      const run = await runs.getRun(db, run_id);
      expect(run).toMatchObject({ status: "planned", applied_at: null });
      expect(run.plan!.applied).toBeUndefined();
    });

    it("E: перенос и создание в филиал другой организации не применяются (stale)", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const tA = (await makeTerminal(db, { organization_id: org })).id;
      const tForeign = (await makeTerminal(db, { organization_id: await makeOrg() })).id;
      // Испорченная карта: локация этой организации указывает на чужой филиал.
      await mapLocation(org, company, 9, tForeign);
      const p = person();
      const e = await mkEmp({ p, terminal_id: tA, link: { company, id: 1 }, tab: "T1" });
      const pNew = person();
      const client = fakeClient(company, [wEmp(1, p, { loc: 9 }), wEmp(2, pNew, { loc: 9 })], [], [{ id: 9, title: "L9" }]);
      const { run_id, run } = await plan(org, client);
      expect(run.plan!.items.map((i) => i.key)).toEqual([`move:${e}`, "create:w2"]);
      const before = await emp(e);
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res).toEqual({
        applied: 0,
        skipped: [
          { key: "create:w2", reason: "stale" },
          { key: `move:${e}`, reason: "stale" },
        ],
      });
      expect(await emp(e)).toEqual(before);
      expect(await createdBy(company, 2)).toBeUndefined();
    });

    // ---------- syncAuto и hasAppliedRun ----------

    it("hasAppliedRun: только применённый прогон сотрудников этой организации", async () => {
      const org = await makeOrg();
      expect(await runs.hasAppliedRun(db, org)).toBe(false);
      await insertRun(org, { kind: "attendance", status: "applied" });
      await insertRun(org, { status: "rolled_back" });
      await insertRun(org, { status: "planned" });
      expect(await runs.hasAppliedRun(db, org)).toBe(false);
      await insertRun(org, { status: "applied" });
      expect(await runs.hasAppliedRun(db, org)).toBe(true);
      expect(await runs.hasAppliedRun(db, await makeOrg())).toBe(false);
    });

    it("syncAuto без применённого прогона сотрудников (есть только посещаемость) — blocked/first_run, employees не изменились", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { kind: "attendance", status: "applied", active_fetched: 5 });
      const before = await snap(w.ids);
      const row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => w.client);
      expect(row).toMatchObject({ trigger: "schedule", status: "blocked", block_reason: "first_run", applied_at: null });
      expect(row.plan!.items.length).toBe(6);
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
    });

    it("syncAuto: 11 деактиваций при 20 активных — blocked/too_many_deactivations, сотрудники не изменились", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const active: WorklyEmployee[] = [];
      const dismissed: WorklyDismissed[] = [];
      const ids: string[] = [];
      for (let k = 1; k <= 20; k++) {
        const p = person();
        ids.push(await mkEmp({ p, terminal_id: t, link: { company, id: k }, tab: `T${k}` }));
        if (k <= 11) dismissed.push(wDis(k, p));
        else active.push(wEmp(k, p));
      }
      await insertRun(org, { status: "applied", active_fetched: 9 });
      const before = await snap(ids);
      const row = await runs.syncAuto(db, redis, { id: org, key: "LES" }, () => fakeClient(company, active, dismissed, []));
      expect(row).toMatchObject({ status: "blocked", block_reason: "too_many_deactivations" });
      expect(row.counts.deactivate).toBe(11);
      expect(await snap(ids)).toEqual(before);
    });

    it("syncAuto в пределах предохранителей применяет план сам", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { status: "applied", active_fetched: 5 });
      const row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => w.client);
      expect(row).toMatchObject({ trigger: "schedule", status: "applied", block_reason: null });
      expect(row.plan!.applied).toHaveLength(6);
      expect((await emp(w.eDeact)).active).toBe(false);
      expect(await createdBy(w.company, 5)).toBeDefined();
    });

    it("syncAuto при сбое обхода возвращает failed и ничего не применяет", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { status: "applied", active_fetched: 5 });
      const before = await snap(w.ids);
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const bad = fakeClient(w.company, w.active, w.dismissed, w.locations, {
          method: "dismissed",
          error: new WorklyError("http_error", "Workly вернул HTTP 500"),
        });
        const row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => bad);
        expect(row).toMatchObject({ status: "failed", error: "http_error" });
      } finally {
        spy.mockRestore();
      }
      expect(await snap(w.ids)).toEqual(before);
    });

    // Должность из Workly длиннее employees.position (varchar 150): запись пункта падает
    // ошибкой базы, а не конфликтом.
    const LONG_TITLE = "Тестовая должность ".repeat(10);
    const longTitleClient = (w: Awaited<ReturnType<typeof buildWorld>>) =>
      fakeClient(
        w.company,
        w.active.map((x) => (x.id === 2 ? { ...x, positions: [{ id: 9, title: LONG_TITLE }] } : x)),
        w.dismissed,
        w.locations
      );

    it("B: ночное применение упало не на конфликте — failed/apply_failed, сотрудники не изменились, текста ошибки нет", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { status: "applied", active_fetched: 5 });
      const before = await snap(w.ids);
      const logged: string[] = [];
      const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
      let row: Awaited<ReturnType<typeof runs.syncAuto>>;
      try {
        row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => longTitleClient(w));
      } finally {
        spy.mockRestore();
      }
      expect(row).toMatchObject({ trigger: "schedule", status: "failed", error: "apply_failed", applied_at: null });
      expect(row.plan!.applied).toBeUndefined();
      expect(JSON.stringify(await rawRun(row.id))).not.toContain("too long");
      expect(logged.join("\n")).not.toContain("too long");
      expect(logged.join("\n")).toContain("apply_failed");
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
    });

    it("B: тот же план через ручной applyRun — ошибка, прогон остаётся planned, сотрудники не изменились", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, longTitleClient(w));
      const before = await snap(w.ids);
      await expect(runs.applyRun(db, run_id, [], null)).rejects.toBeInstanceOf(Error);
      expect(await runs.getRun(db, run_id)).toMatchObject({ status: "planned", error: null, applied_at: null });
      expect(await snap(w.ids)).toEqual(before);
    });

    it("B: план вытеснен более новым во время ночного прогона — строка остаётся planned, ничего не применено", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { status: "applied", active_fetched: 5 });
      const before = await snap(w.ids);
      // Пока ночной прогон обходит Workly, человек успел построить новый план.
      const client = fakeClient(w.company, w.active, w.dismissed, w.locations);
      const dismissed = client.dismissed;
      let newer = "";
      client.dismissed = async () => {
        newer = await insertRun(w.org, { status: "planned" });
        return dismissed();
      };
      const row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => client);
      expect(newer).not.toBe("");
      expect(row).toMatchObject({ status: "planned", error: null, applied_at: null });
      expect(await snap(w.ids)).toEqual(before);
    });

    it("E: нецелый счётчик для предохранителей — failed/crawl_failed, ничего не применено", async () => {
      const w = await buildWorld();
      await insertRun(w.org, { status: "applied", active_fetched: 5 });
      const before = await snap(w.ids);
      if (!/^[0-9a-f-]{36}$/.test(w.org)) throw new Error("org id не uuid");
      // Триггер только для этой организации портит counts.deactivate при записи planned.
      const drop = async () => {
        await db.execute(sql.raw("DROP TRIGGER IF EXISTS wl_test_bad_counts ON workly_sync_runs"));
        await db.execute(sql.raw("DROP FUNCTION IF EXISTS wl_test_bad_counts()"));
      };
      await drop();
      await db.execute(
        sql.raw(
          "CREATE FUNCTION wl_test_bad_counts() RETURNS trigger LANGUAGE plpgsql AS " +
            "$f$ BEGIN NEW.counts := jsonb_set(NEW.counts, '{deactivate}', '1.5'::jsonb); RETURN NEW; END $f$"
        )
      );
      await db.execute(
        sql.raw(
          "CREATE TRIGGER wl_test_bad_counts BEFORE UPDATE ON workly_sync_runs FOR EACH ROW " +
            `WHEN (NEW.organization_id = '${w.org}'::uuid AND NEW.status = 'planned') EXECUTE FUNCTION wl_test_bad_counts()`
        )
      );
      const spy = spyOn(console, "error").mockImplementation(() => {});
      let row: Awaited<ReturnType<typeof runs.syncAuto>>;
      try {
        row = await runs.syncAuto(db, redis, { id: w.org, key: "LES" }, () => w.client);
      } finally {
        spy.mockRestore();
        await drop();
      }
      expect(row.counts.deactivate).toBe(1.5);
      expect(row).toMatchObject({ status: "failed", error: "crawl_failed", block_reason: null });
      expect(await snap(w.ids)).toEqual(before);
      expect(await createdBy(w.company, 5)).toBeUndefined();
    });

    // ---------- откат прогона ----------

    it("откат: link, move, update, reactivate и deactivate возвращаются, созданный без ссылок удалён, новый план как до применения; повторный откат — run_not_applied", async () => {
      const w = await buildWorld();
      const first = await plan(w.org, w.client);
      const before = strip(await snap(w.ids));
      await runs.applyRun(db, first.run_id, [], null);
      const created = await createdBy(w.company, 5);
      expect(created).toBeDefined();

      const res = await runs.rollbackRun(db, first.run_id);
      expect(res).toEqual({ restored: 5, deleted: 1, deactivated: 0, skipped: [] });
      expect(await emp(w.eLink)).toMatchObject({
        terminal_id: w.tA,
        workly_company_id: null,
        workly_id: null,
        workly_tab_number: null,
        position: null,
        staff_role_id: null,
        active: true,
      });
      expect(await emp(w.eDeact)).toMatchObject({ active: true, workly_company_id: w.company, workly_id: 3 });
      expect(await emp(w.eReact)).toMatchObject({ active: false, workly_id: 4 });
      expect(await emp(w.eUpd)).toMatchObject({ position: "Старая должность", workly_tab_number: "OLD", staff_role_id: null });
      expect(strip(await snap(w.ids))).toEqual(before);
      expect(await emp(created.id)).toBeUndefined();

      const run = await runs.getRun(db, first.run_id);
      expect(run.status).toBe("rolled_back");
      expect(run.plan!.rolled_back).toEqual(res);
      expect(run.plan!.applied).toHaveLength(6);

      // Состояние действительно прежнее: Workly тот же, и план выходит тем же.
      const again = await plan(w.org, w.client);
      expect(shape(again.run.plan!)).toEqual(shape(first.run.plan!));

      const err = await runs.rollbackRun(db, first.run_id).catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 409, code: "run_not_applied" });
      expect((await runs.getRun(db, first.run_id)).plan!.rolled_back).toEqual(res);
    });

    // Применённый прогон buildWorld и созданный им сотрудник (w5).
    async function appliedWorld() {
      const w = await buildWorld();
      const first = await plan(w.org, w.client);
      await runs.applyRun(db, first.run_id, [], null);
      const created = await createdBy(w.company, 5);
      return { w, first, created };
    }

    it("откат: созданный сотрудник со ссылкой из другой таблицы (employee_id uuid) остаётся с active = false", async () => {
      const { w, first, created } = await appliedWorld();
      await withRefTable("employee_id", "uuid", created.id, async () => {
        const res = await runs.rollbackRun(db, first.run_id);
        expect(res).toEqual({ restored: 5, deleted: 0, deactivated: 1, skipped: [] });
        expect(await emp(created.id)).toMatchObject({
          active: false,
          first_name: w.p.create.first_name,
          last_name: w.p.create.last_name,
          terminal_id: w.tA,
          workly_company_id: w.company,
          workly_id: 5,
        });
        // Связь осталась, поэтому следующий план возвращает его, а не создаёт заново.
        const again = await plan(w.org, w.client);
        const expected = first.run.plan!.items.map((i) => (i.key === "create:w5" ? `reactivate:${created.id}` : i.key));
        expect(again.run.plan!.items.map((i) => i.key).sort()).toEqual(expected.sort());
      });
    });

    it("откат: ссылка через колонку *_employee_id (actor_employee_id) тоже держит созданного: active = false", async () => {
      const { first, created } = await appliedWorld();
      await withRefTable("actor_employee_id", "uuid", created.id, async () => {
        expect(await runs.rollbackRun(db, first.run_id)).toEqual({ restored: 5, deleted: 0, deactivated: 1, skipped: [] });
        expect((await emp(created.id)).active).toBe(false);
      });
    });

    it("откат: колонка employee_id не uuid (text) сравнивается как текст: ссылка найдена, active = false", async () => {
      const { first, created } = await appliedWorld();
      await withRefTable("employee_id", "text", created.id, async () => {
        expect(await runs.rollbackRun(db, first.run_id)).toEqual({ restored: 5, deleted: 0, deactivated: 1, skipped: [] });
        expect((await emp(created.id)).active).toBe(false);
      });
    });

    it("откат: созданный сотрудник, которого HR выключил после применения, не удаляется (changed_since)", async () => {
      const { first, created } = await appliedWorld();
      await db.update(employees).set({ active: false }).where(eq(employees.id, created.id));
      const kept = await emp(created.id);
      const rb = await runs.rollbackRun(db, first.run_id);
      expect(rb).toEqual({ restored: 5, deleted: 0, deactivated: 0, skipped: changed("create:w5") });
      expect(await emp(created.id)).toEqual(kept);
    });

    it("откат N после N+1, сменившего должность созданного: create changed_since, строка цела, никто не удалён", async () => {
      const { w, first, created } = await appliedWorld();
      // В Workly у w5 другая должность: прогон N+1 обновляет созданного сотрудника.
      const client2 = fakeClient(
        w.company,
        w.active.map((x) => (x.id === 5 ? { ...x, positions: [{ id: 1, title: "Кассир" }] } : x)),
        w.dismissed,
        w.locations
      );
      const n1 = await plan(w.org, client2);
      expect(n1.run.plan!.items.map((i) => i.key)).toEqual([`update:${created.id}`]);
      await runs.applyRun(db, n1.run_id, [], null);
      const kept = await emp(created.id);
      expect(kept.position).toBe(structure("Кассир").position);

      const rb = await runs.rollbackRun(db, first.run_id);
      expect(rb).toEqual({ restored: 5, deleted: 0, deactivated: 0, skipped: changed("create:w5") });
      expect(await emp(created.id)).toEqual(kept);
    });

    it("откат: созданный сотрудник, которого после применения перевели в другой филиал, не удаляется (changed_since)", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      const created = await createdBy(w.company, 5);
      await db.update(employees).set({ terminal_id: w.tB }).where(eq(employees.id, created.id));
      const kept = await emp(created.id);
      const rb = await runs.rollbackRun(db, run_id);
      expect(rb).toEqual({ restored: 5, deleted: 0, deactivated: 0, skipped: changed("create:w5") });
      expect(await emp(created.id)).toEqual(kept);
    });

    it("откат прогона N после применённого N+1, изменившего те же поля: пункты changed_since, новые значения целы", async () => {
      const w = await buildWorld();
      const n = await plan(w.org, w.client);
      await runs.applyRun(db, n.run_id, [], null);

      // В Workly w2 сменил должность, w1 перешёл в локацию филиала tA.
      const client2 = fakeClient(
        w.company,
        w.active.map((x) =>
          x.id === 2 ? { ...x, positions: [{ id: 1, title: "Повар" }] } : x.id === 1 ? { ...x, locations: [{ id: 1, title: "L1" }] } : x
        ),
        w.dismissed,
        w.locations
      );
      const n1 = await plan(w.org, client2);
      expect(n1.run.plan!.items.map((i) => i.key).sort()).toEqual([`move:${w.eLink}`, `update:${w.eUpd}`].sort());
      await runs.applyRun(db, n1.run_id, [], null);
      const cook = structure("Повар");
      const upd = await emp(w.eUpd);
      expect(upd).toMatchObject({ position: cook.position, terminal_id: w.tA });

      const res = await runs.rollbackRun(db, n.run_id);
      // Перенос отменяется первым (применялся последним), затем остальные в обратном порядке.
      expect(res.skipped).toEqual(changed(`move:${w.eLink}`, `update:${w.eUpd}`));
      expect(res).toMatchObject({ restored: 3, deleted: 1, deactivated: 0 });
      expect(await emp(w.eUpd)).toEqual(upd);
      expect((await emp(w.eLink)).terminal_id).toBe(w.tA);
      expect((await runs.getRun(db, n1.run_id)).status).toBe("applied");
    });

    it("откат не трогает пункты из plan.skipped (исключённые и устаревшие)", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await db.update(employees).set({ position: "Изменено вручную" }).where(eq(employees.id, w.eUpd));
      const res = await runs.applyRun(db, run_id, [`deactivate:${w.eDeact}`], null);
      expect(res.skipped).toEqual([
        { key: `update:${w.eUpd}`, reason: "stale" },
        { key: `deactivate:${w.eDeact}`, reason: "excluded" },
      ]);
      // Оба сотрудника приведены к after своих пунктов: откат, который тронул бы эти пункты,
      // вернул бы им before.
      const p = (await runs.getRun(db, run_id)).plan!;
      for (const key of [`update:${w.eUpd}`, `deactivate:${w.eDeact}`]) {
        const it = itemOf(p, key);
        await db.update(employees).set(it.after as never).where(eq(employees.id, it.employee_id!));
      }
      const mid = await snap([w.eUpd, w.eDeact]);

      const rb = await runs.rollbackRun(db, run_id);
      expect(rb).toEqual({ restored: 3, deleted: 1, deactivated: 0, skipped: [] });
      expect(await snap([w.eUpd, w.eDeact])).toEqual(mid);
    });

    it("откат: link и move одного сотрудника отменяются оба, перенос раньше связи", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const tA = (await makeTerminal(db, { organization_id: org })).id;
      const tB = (await makeTerminal(db, { organization_id: org })).id;
      await mapLocation(org, company, 2, tB);
      const p = person();
      const e = await mkEmp({ p, terminal_id: tA });
      const client = fakeClient(company, [wEmp(1, p, { loc: 2, title: "Повар" })], [], [{ id: 2, title: "L2" }]);
      const first = await plan(org, client);
      expect(first.run.plan!.items.map((i) => i.key)).toEqual([`link:${e}`, `move:${e}`]);
      const before = strip(await snap([e]));
      await runs.applyRun(db, first.run_id, [], null);
      expect(await emp(e)).toMatchObject({ terminal_id: tB, workly_id: 1 });
      expect((await runs.getRun(db, first.run_id)).plan!.applied).toEqual([`link:${e}`, `move:${e}`]);

      expect(await runs.rollbackRun(db, first.run_id)).toEqual({ restored: 2, deleted: 0, deactivated: 0, skipped: [] });
      expect(strip(await snap([e]))).toEqual(before);
      expect(shape((await plan(org, client)).run.plan!)).toEqual(shape(first.run.plan!));

      // Порядок виден по пропускам: оба пункта изменены вручную, перенос идёт первым.
      const w = await buildWorld();
      const second = await plan(w.org, w.client);
      await runs.applyRun(db, second.run_id, [], null);
      await db.update(employees).set({ position: "Вручную", terminal_id: w.tA }).where(eq(employees.id, w.eLink));
      const rb = await runs.rollbackRun(db, second.run_id);
      expect(rb.skipped).toEqual(changed(`move:${w.eLink}`, `link:${w.eLink}`));
      expect(await emp(w.eLink)).toMatchObject({ position: "Вручную", terminal_id: w.tA, workly_id: 1 });
    });

    it("откат: роль, изменённая вручную после применения, делает пункт changed_since", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      const role = await ensureStaffRole(db, "cook");
      expect(role).not.toBe(structure("Кассир").staff_role_id);
      await db.update(employees).set({ staff_role_id: role }).where(eq(employees.id, w.eUpd));
      const upd = await emp(w.eUpd);
      const rb = await runs.rollbackRun(db, run_id);
      expect(rb.skipped).toEqual(changed(`update:${w.eUpd}`));
      expect(rb).toMatchObject({ restored: 4, deleted: 1 });
      expect(await emp(w.eUpd)).toEqual(upd);
    });

    it("откат: сотрудник перепривязан к другой записи Workly после применения — пункт update changed_since, новая связь цела", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      // Меняется только пара Workly; поля из after пункта update те же, что записал прогон.
      await db.update(employees).set({ workly_id: 200 }).where(eq(employees.id, w.eUpd));
      const upd = await emp(w.eUpd);
      const rb = await runs.rollbackRun(db, run_id);
      expect(rb.skipped).toEqual(changed(`update:${w.eUpd}`));
      expect(await emp(w.eUpd)).toEqual(upd);
    });

    it("откат: прежнюю пару Workly занял другой сотрудник — пункт relink changed_since, связь не тронута", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const p = person();
      // Связан с уволенной записью 9; в Workly есть активная запись 10 с тем же именем: relink.
      const e = await mkEmp({ p, terminal_id: t, link: { company, id: 9 }, tab: "T9" });
      const other = await mkEmp({ terminal_id: t });
      const client = fakeClient(company, [wEmp(10, p)], [wDis(9, p)], []);
      const first = await plan(org, client);
      expect(first.run.plan!.items.map((i) => i.key)).toEqual([`relink:${e}`]);
      await runs.applyRun(db, first.run_id, [], null);
      expect(await emp(e)).toMatchObject({ workly_company_id: company, workly_id: 10 });
      await db.update(employees).set({ workly_company_id: company, workly_id: 9 }).where(eq(employees.id, other));
      const before = await snap([e, other]);

      const rb = await runs.rollbackRun(db, first.run_id);
      expect(rb).toEqual({ restored: 0, deleted: 0, deactivated: 0, skipped: changed(`relink:${e}`) });
      expect(await snap([e, other])).toEqual(before);
      expect((await runs.getRun(db, first.run_id)).status).toBe("rolled_back");
    });

    it("откат не трогает сотрудников другой организации и не переносит в её филиал", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      const created = await createdBy(w.company, 5);
      // Филиал tA ушёл в другую организацию вместе со всеми, кто в нём числится.
      const orgB = await makeOrg();
      await db.update(terminals).set({ organization_id: orgB }).where(eq(terminals.id, w.tA));
      const foreign = [w.eUpd, w.eDeact, w.eReact, w.eGone, created.id];
      const fBefore = await snap(foreign);

      const rb = await runs.rollbackRun(db, run_id);
      expect(rb).toEqual({
        restored: 1,
        deleted: 0,
        deactivated: 0,
        // move:eLink вернул бы сотрудника в tA, который теперь чужой.
        skipped: changed(`move:${w.eLink}`, `deactivate:${w.eDeact}`, "create:w5", `reactivate:${w.eReact}`, `update:${w.eUpd}`),
      });
      expect(await snap(foreign)).toEqual(fBefore);
      expect(await emp(w.eLink)).toMatchObject({ terminal_id: w.tB, workly_id: null, workly_company_id: null });
    });

    it("откат: ошибка пункта откатывает весь откат, прогон остаётся applied, сотрудники как после применения", async () => {
      const w = await buildWorld();
      const { run_id } = await plan(w.org, w.client);
      await runs.applyRun(db, run_id, [], null);
      const created = await createdBy(w.company, 5);
      // Пункт link отменяется последним; его before ссылается на несуществующую роль: внешний ключ.
      await tamperPlan(run_id, (p) => {
        itemOf(p, `link:${w.eLink}`).before!.staff_role_id = randomUUID();
      });
      const mid = await snap([...w.ids, created.id]);
      const err = await runs.rollbackRun(db, run_id).catch((e) => e);
      expect(err).toBeInstanceOf(runs.RollbackItemError);
      expect(err).not.toBeInstanceOf(KpiError);
      // Наружу только ключ пункта, без текста ошибки базы (в нём параметры запроса).
      expect(err).toMatchObject({ name: "RollbackItemError", key: `link:${w.eLink}`, message: "rollback_item_failed" });
      expect(JSON.stringify(err)).not.toContain("foreign key");
      expect((err as Error).cause).toBeUndefined();
      // Перенос, деактивация, удаление созданного и прочее шли раньше и тоже откатились.
      expect(await snap([...w.ids, created.id])).toEqual(mid);
      const run = await runs.getRun(db, run_id);
      expect(run.status).toBe("applied");
      expect(run.plan!.rolled_back).toBeUndefined();
    });

    it("откат прогона не в статусе applied или не сотрудников — run_not_applied; чужой id — run_not_found", async () => {
      const w = await buildWorld();
      const planned = await plan(w.org, w.client);
      const ids = [
        planned.run_id,
        await insertRun(w.org, { status: "failed" }),
        await insertRun(w.org, { status: "blocked" }),
        await insertRun(w.org, { kind: "attendance", status: "applied" }),
        // applied без плана: откатывать нечего.
        await insertRun(w.org, { status: "applied" }),
      ];
      const before = await snap(w.ids);
      for (const id of ids) {
        const err = await runs.rollbackRun(db, id).catch((e) => e);
        expect(err).toBeInstanceOf(KpiError);
        expect(err).toMatchObject({ status: 409, code: "run_not_applied" });
      }
      expect((await runs.getRun(db, planned.run_id)).status).toBe("planned");
      expect(await snap(w.ids)).toEqual(before);
      await expect(runs.rollbackRun(db, randomUUID())).rejects.toMatchObject({ status: 404, code: "run_not_found" });
      await expect(runs.rollbackRun(db, "не-uuid")).rejects.toMatchObject({ status: 404, code: "run_not_found" });
    });

    // ---------- linkManually ----------

    it("linkManually ставит связь; тот же workly_id у второго — workly_id_taken; чужая организация — employee_not_found", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const e1 = await mkEmp({ terminal_id: t });
      const e2 = await mkEmp({ terminal_id: t });
      await runs.linkManually(db, { organizationId: org, companyId: company, employeeId: e1, worklyId: 77, tabNumber: " T77 " }, null);
      expect(await emp(e1)).toMatchObject({ workly_company_id: company, workly_id: 77, workly_tab_number: "T77" });
      // Повтор на того же сотрудника допустим.
      await runs.linkManually(db, { organizationId: org, companyId: company, employeeId: e1, worklyId: 77, tabNumber: "T77" }, null);

      const before = await emp(e2);
      const err = await runs
        .linkManually(db, { organizationId: org, companyId: company, employeeId: e2, worklyId: 77, tabNumber: "T77" }, null)
        .catch((e) => e);
      expect(err).toBeInstanceOf(KpiError);
      expect(err).toMatchObject({ status: 409, code: "workly_id_taken" });
      expect(await emp(e2)).toEqual(before);

      const other = await makeOrg();
      await expect(
        runs.linkManually(db, { organizationId: other, companyId: company, employeeId: e2, worklyId: 78, tabNumber: "T78" }, null)
      ).rejects.toMatchObject({ status: 404, code: "employee_not_found" });
      expect(await emp(e2)).toEqual(before);
    });

    // ---------- KPI ----------

    it("деактивированный сотрудник с оценкой за период остаётся в списке оценки KPI, без оценки скрыт", async () => {
      const org = await makeOrg();
      const company = newCompany();
      const t = (await makeTerminal(db, { organization_id: org })).id;
      const pR = person();
      const pN = person();
      const reviewed = await mkEmp({ p: pR, terminal_id: t, link: { company, id: 1 }, role_code: "cook" });
      const plain = await mkEmp({ p: pN, terminal_id: t, link: { company, id: 2 }, role_code: "cook" });
      await db.insert(kpi_reviews).values({
        period: P,
        employee_id: reviewed,
        terminal_id: t,
        card_id: randomUUID(),
        evaluator_user_id: randomUUID(),
        status: "submitted",
        score_pct: "90.00",
        submitted_at: "2026-10-20T05:00:00.000Z",
      });
      const actor = { userId: randomUUID(), perms: new Set(["kpi.approve"]), isHq: false, terminals: [] };
      const listed = async () => (await listEmployeeRows(db, actor, { period: P, terminal_id: t })).map((r) => r.id).sort();
      expect(await listed()).toEqual([reviewed, plain].sort());

      // В Workly оба уволены; один активный без локации нужен, чтобы обход не был пустым.
      const client = fakeClient(company, [wEmp(3, person())], [wDis(1, pR), wDis(2, pN)], []);
      const { run_id } = await plan(org, client);
      const res = await runs.applyRun(db, run_id, [], null);
      expect(res.applied).toBe(2);
      expect((await emp(reviewed)).active).toBe(false);
      expect((await emp(plain)).active).toBe(false);
      expect(await listed()).toEqual([reviewed]);
    });
  });
}
