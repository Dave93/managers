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
  const { employees, kpi_reviews, organization, staff_roles, workly_locations, workly_sync_runs } = await import(
    "backend/drizzle/schema"
  );
  const { KpiError } = await import("../../kpi/errors");
  const { listEmployeeRows } = await import("../../kpi/employees");
  const { structureFrom } = await import("../../staff_roles/catalog");
  const { WorklyError } = await import("../client");
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

  describe("workly: журнал прогонов и применение плана", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const roles = await db.select().from(staff_roles);
      structure = (title: string) => structureFrom(roles, { position: title }, false);
      // Тестовые организации названы не как подключения: ключ подключения подставляем.
      runs.setConnKeyResolver(async () => "LES");
    }, 180000);

    afterAll(async () => {
      runs.setConnKeyResolver(null);
      queue.setRunEnqueuer(null);
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

    it("A: более новые failed, rolled_back и running не вытесняют план", async () => {
      const w = await buildWorld();
      const a = await plan(w.org, w.client);
      await insertRun(w.org, { status: "failed" });
      await insertRun(w.org, { status: "rolled_back" });
      await insertRun(w.org, { status: "running" });
      expect((await runs.applyRun(db, a.run_id, [], null)).applied).toBe(6);
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
