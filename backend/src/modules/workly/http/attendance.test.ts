import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в workly/http/runs.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/attendance (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/attendance.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { cleanupKpi, makeTerminal, setNow, setup } = await import("../../kpi/http/fixtures");
  const { employees, kpi_attendance, kpi_attendance_imports, kpi_periods, organization, workly_sync_runs } = await import(
    "backend/drizzle/schema"
  );
  const { iso } = await import("../../kpi/iso");
  const { writeAttendanceImport } = await import("../../kpi/attendance");
  const { WorklyError } = await import("../client");
  const config = await import("../config");
  const runs = await import("../runs");
  const att = await import("../attendance");
  const { and, asc, eq } = await import("drizzle-orm");
  type RunClient = import("../runs").RunClient;
  type WorklyEmployee = import("../types").WorklyEmployee;
  type T12Item = import("../types").T12Item;
  type T12Day = import("../types").T12Day;
  type LateInItem = import("../types").LateInItem;
  type AbsenceItem = import("../types").AbsenceItem;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;
  // Redis клиенту не нужен: тесты всегда передают свой clientOf.
  const redis = {} as unknown as Redis;

  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 500_000_000 + Math.floor(Math.random() * 100_000_000);

  // 12:00 по Ташкенту 20 октября: окно октября — с 1-го по 19-е, сентябрь целиком.
  const NOW = "2026-10-20T07:00:00.000Z";
  const P = "2026-10-01";
  const WIN = { from: "2026-10-01", to: "2026-10-19" };

  // ---------- подставной клиент ----------

  type Data = { employees?: WorklyEmployee[]; t12?: T12Item[]; lateIn?: LateInItem[]; absence?: AbsenceItem[] };
  type Call = { method: string; args: unknown[] };
  type Fake = RunClient & { calls: Call[]; maxInflight: number };

  // Фиксированные ответы; fail подменяет один метод исключением, before выполняется
  // перед ответом метода. Счётчик inflight ловит параллельные обходы одного клиента.
  function fakeClient(
    company: number,
    data: Data,
    o: { fail?: { method: string; error: unknown }; before?: Record<string, () => Promise<void>> } = {}
  ): Fake {
    let inflight = 0;
    const fake = { calls: [] as Call[], maxInflight: 0 } as Fake;
    const wrap =
      <T>(method: string, value: () => T) =>
      async (...args: unknown[]): Promise<T> => {
        fake.calls.push({ method, args });
        inflight++;
        fake.maxInflight = Math.max(fake.maxInflight, inflight);
        try {
          await new Promise((r) => setTimeout(r, 1));
          await o.before?.[method]?.();
          if (o.fail?.method === method) throw o.fail.error;
          return value();
        } finally {
          inflight--;
        }
      };
    Object.assign(fake, {
      companyId: wrap("companyId", () => company),
      employees: wrap("employees", () => data.employees ?? []),
      dismissed: wrap("dismissed", () => []),
      locations: wrap("locations", () => []),
      t12: wrap("t12", () => data.t12 ?? []),
      lateIn: wrap("lateIn", () => data.lateIn ?? []),
      absence: wrap("absence", () => data.absence ?? []),
    });
    return fake;
  }

  const wEmp = (id: number, start_date = "2026-01-01"): WorklyEmployee => ({
    id,
    first_name: "Тест",
    last_name: `W${id}`,
    patronymic: "",
    tab_number: `T${id}`,
    start_date,
    positions: [],
    locations: [],
  });
  const tday = (report_date: string, o: Partial<T12Day> = {}): T12Day => ({
    report_date,
    is_work_day: true,
    is_holiday: false,
    work_time: "00:00",
    ...o,
  });
  const t12 = (employee_id: number, days: T12Day[] | null): T12Item => ({ employee_id, report: days ? { days } : null });
  const late = (id: number, d: string, a: Partial<LateInItem["actual"]> = {}): LateInItem => ({
    employee: { id },
    scheduled: { report_date: d },
    actual: { first_in: "09:00", last_out: "18:00", late_in: null, ...a },
  });
  const absent = (id: number, d: string, timeoff_id: number | null = null): AbsenceItem => ({
    employee: { id },
    scheduled: { report_date: d, is_work_day: true, timeoff_id },
  });

  // ---------- данные ----------

  const makeOrg = async (): Promise<string> => {
    const [row] = await db.insert(organization).values({ name: `wl_test_att_${hex()}` }).returning({ id: organization.id });
    return row.id;
  };

  // Имя «Тест …»: cleanupKpi удаляет таких сотрудников.
  const mkEmp = async (terminal_id: string, link: { company: number; id: number } | null, active = true): Promise<string> => {
    const [row] = await db
      .insert(employees)
      .values({
        first_name: "Тест",
        last_name: "A" + hex(),
        terminal_id,
        active,
        workly_company_id: link?.company ?? null,
        workly_id: link?.id ?? null,
      })
      .returning({ id: employees.id });
    return row.id;
  };

  const world = async () => {
    const org = await makeOrg();
    const company = newCompany();
    const t = (await makeTerminal(db, { organization_id: org })).id;
    return { org, company, t };
  };

  // Дни сотрудника: [день, прогул, опоздание, приход, уход] по возрастанию дня.
  const daysOf = async (employeeId: string) =>
    (await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, employeeId)).orderBy(asc(kpi_attendance.day))).map(
      (d) => ({
        day: d.day,
        absent: d.absent,
        late: d.late_minutes,
        in: iso(d.check_in),
        out: iso(d.check_out),
        terminal_id: d.terminal_id,
        import_id: d.import_id,
      })
    );
  const importsOf = async (org: string, period: string) =>
    db
      .select()
      .from(kpi_attendance_imports)
      .where(and(eq(kpi_attendance_imports.organization_id, org), eq(kpi_attendance_imports.period, period)))
      .orderBy(asc(kpi_attendance_imports.created_at));
  // import_id прогона посещаемости из counts (там же числа, поэтому тип шире строки).
  const importOf = (run: { counts: Record<string, number | string> }) => String(run.counts.import_id);
  const rawRun = async (id: string) => (await db.select().from(workly_sync_runs).where(eq(workly_sync_runs.id, id)))[0];

  // Прогон посещаемости целиком: строка журнала, затем задача очереди (executeRun).
  const sync = async (org: string, client: Fake, period = P, user: string | null = null) => {
    const { run_id } = await runs.startRun(db, { id: org, key: "LES" }, "attendance", "manual", user, period);
    await runs.executeRun(db, redis, run_id, () => client);
    return { run_id, run: await runs.getRun(db, run_id) };
  };

  // Ошибки прогона пишутся в console.error: глушим и собираем, чтобы проверить отсутствие текста исключений.
  const quietly = async <T>(f: () => Promise<T>): Promise<{ value: T; logged: string }> => {
    const logged: string[] = [];
    const spy = spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(" "));
    });
    try {
      return { value: await f(), logged: logged.join("\n") };
    } finally {
      spy.mockRestore();
    }
  };

  describe("workly: посещаемость", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      // Тестовые организации названы не как подключения: ключ подключения подставляем.
      runs.setConnKeyResolver(async () => "LES");
      // Подставные клиенты отдают случайные номера компаний: сверка компании выключена,
      // её проверяет отдельный тест company_mismatch.
      config.setExpectedCompanyResolver(() => null);
      setNow(NOW);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      runs.setConnKeyResolver(null);
      config.setExpectedCompanyResolver(null);
      await cleanupKpi(db);
    });

    // ---------- assertAttendanceSyncable ----------

    it("assertAttendanceSyncable: закрытый месяц — 409 period_closed, месяц без прошедших дней — 422 period_not_started", async () => {
      await db.insert(kpi_periods).values({ period: "2026-08-01", status: "closed" });
      await expect(att.assertAttendanceSyncable(db, "2026-08-01")).rejects.toMatchObject({ status: 409, code: "period_closed" });
      // Будущий месяц
      await expect(att.assertAttendanceSyncable(db, "2026-11-01")).rejects.toMatchObject({ status: 422, code: "period_not_started" });
      // Открытый месяц с прошедшими днями, и прошлый открытый целиком
      await att.assertAttendanceSyncable(db, P);
      await att.assertAttendanceSyncable(db, "2026-09-01");
      try {
        // 1 октября 05:00 по Ташкенту: вчера ещё сентябрь, у октября прошедших дней нет
        setNow("2026-10-01T00:00:00.000Z");
        await expect(att.assertAttendanceSyncable(db, P)).rejects.toMatchObject({ status: 422, code: "period_not_started" });
        // 2 октября 00:30 по Ташкенту (а по UTC ещё 1-е): день считается по Ташкенту, 1 октября уже прошло
        setNow("2026-10-01T19:30:00.000Z");
        await att.assertAttendanceSyncable(db, P);
      } finally {
        setNow(NOW);
      }
    });

    // ---------- прогон ----------

    it("startRun + executeRun: импорт committed с source api и организацией, журнал applied с counts; клиент по очереди, окно месяца", async () => {
      const w = await world();
      const t2 = (await makeTerminal(db, { organization_id: w.org })).id;
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const eB = await mkEmp(t2, { company: w.company, id: 2 });
      const eLoose = await mkEmp(w.t, null);
      const user = randomUUID();
      const client = fakeClient(w.company, {
        employees: [wEmp(1), wEmp(2, "2026-10-05")],
        t12: [
          t12(1, [
            tday("2026-10-01", { work_time: "08:55" }),
            tday("2026-10-02"),
            tday("2026-10-03"),
            tday("2026-10-04", { is_holiday: true }),
          ]),
          t12(2, [tday("2026-10-04", { work_time: "08:00" }), tday("2026-10-05", { work_time: "08:00" })]),
        ],
        lateIn: [late(1, "2026-10-01", { first_in: "09:05", last_out: "18:00", late_in: "00:05" })],
        absence: [absent(1, "2026-10-02")],
      });

      const { run_id, run } = await sync(w.org, client, P, user);

      const [imp, ...rest] = await importsOf(w.org, P);
      expect(rest).toHaveLength(0);
      expect(imp).toMatchObject({
        status: "committed",
        organization_id: w.org,
        file_name: "Workly API",
        uploaded_by: user,
        rows_total: 3,
        rows_matched: 3,
        rows_unmatched: 0,
        unmatched: [],
        mapping: {
          source: "api",
          totals: { days_present: 2, days_late: 1, days_absent: 1 },
          window: WIN,
          unknown: 1,
        },
      });
      expect(run).toMatchObject({
        status: "applied",
        error: null,
        plan: null,
        period: P,
        counts: { days: 3, unknown: 1, carried: 0, import_id: imp.id },
      });
      expect(run.applied_at).not.toBeNull();
      expect((await rawRun(run_id)).workly_company_id).toBe(w.company);

      expect(await daysOf(eA)).toEqual([
        { day: "2026-10-01", absent: false, late: 5, in: "2026-10-01T04:05:00.000Z", out: "2026-10-01T13:00:00.000Z", terminal_id: w.t, import_id: imp.id },
        { day: "2026-10-02", absent: true, late: 0, in: null, out: null, terminal_id: w.t, import_id: imp.id },
      ]);
      // День до start_date из списка сотрудников Workly не пишется
      expect(await daysOf(eB)).toEqual([
        { day: "2026-10-05", absent: false, late: 0, in: null, out: null, terminal_id: t2, import_id: imp.id },
      ]);
      expect(await daysOf(eLoose)).toEqual([]);

      // Обходы строго по одному; отчёты — за окно месяца
      expect(client.maxInflight).toBe(1);
      const reports = client.calls.filter((c) => ["t12", "lateIn", "absence"].includes(c.method));
      expect(reports.map((c) => [c.method, ...c.args])).toEqual([
        ["t12", WIN.from, WIN.to],
        ["lateIn", WIN.from, WIN.to],
        ["absence", WIN.from, WIN.to],
      ]);
      expect(client.calls.some((c) => c.method === "locations" || c.method === "dismissed")).toBe(false);
    });

    it("повторный запуск заменяет импорт; сотрудник из T12 теряет прогул, которого больше нет в absence", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const t12A = t12(1, [tday("2026-10-01", { work_time: "08:00" }), tday("2026-10-02")]);
      const first = await sync(w.org, fakeClient(w.company, { employees: [wEmp(1)], t12: [t12A], absence: [absent(1, "2026-10-02")] }));
      expect(first.run.counts).toMatchObject({ days: 2, unknown: 0, carried: 0 });
      expect((await daysOf(eA)).map((d) => [d.day, d.absent])).toEqual([
        ["2026-10-01", false],
        ["2026-10-02", true],
      ]);

      const second = await sync(w.org, fakeClient(w.company, { employees: [wEmp(1)], t12: [t12A], absence: [] }));
      expect(second.run).toMatchObject({ status: "applied", counts: { days: 1, unknown: 1, carried: 0 } });
      const imps = await importsOf(w.org, P);
      expect(imps.map((i) => [i.id, i.status])).toEqual([
        [importOf(first.run), "replaced"],
        [importOf(second.run), "committed"],
      ]);
      expect((await daysOf(eA)).map((d) => [d.day, d.absent, d.import_id])).toEqual([["2026-10-01", false, importOf(second.run)]]);
    });

    it("перенос: дни сотрудника, которого нет ни в списке, ни в T12, сохраняются; есть в списке без T12 или с report: null — дни уходят", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const eGone = await mkEmp(w.t, { company: w.company, id: 3 }, false);
      const eListed = await mkEmp(w.t, { company: w.company, id: 4 });
      const eNull = await mkEmp(w.t, { company: w.company, id: 5 });
      const present = (id: number) => t12(id, [tday("2026-10-01", { work_time: "08:00" })]);

      const first = await sync(
        w.org,
        fakeClient(w.company, {
          employees: [wEmp(1), wEmp(3), wEmp(4), wEmp(5)],
          t12: [present(1), t12(3, [tday("2026-10-01", { work_time: "08:00" }), tday("2026-10-02")]), present(4), present(5)],
          lateIn: [late(3, "2026-10-01", { first_in: "09:10", last_out: "18:00", late_in: "00:10" })],
          absence: [absent(3, "2026-10-02")],
        })
      );
      expect(first.run.counts).toMatchObject({ days: 5, carried: 0 });
      const goneBefore = await daysOf(eGone);
      expect(goneBefore).toHaveLength(2);

      // eGone уволен посреди месяца: в Workly его больше нет нигде
      const second = await sync(
        w.org,
        fakeClient(w.company, { employees: [wEmp(1), wEmp(4), wEmp(5)], t12: [present(1), t12(5, null)] })
      );
      const newId = importOf(second.run);
      expect(second.run).toMatchObject({ status: "applied", counts: { days: 3, unknown: 0, carried: 2 } });
      expect(await daysOf(eGone)).toEqual(goneBefore.map((d) => ({ ...d, import_id: newId })));
      expect((await daysOf(eA)).map((d) => [d.day, d.import_id])).toEqual([["2026-10-01", newId]]);
      expect(await daysOf(eListed)).toEqual([]);
      expect(await daysOf(eNull)).toEqual([]);
      const [, imp] = await importsOf(w.org, P);
      expect(imp).toMatchObject({
        id: newId,
        status: "committed",
        rows_matched: 3,
        mapping: { source: "api", totals: { days_present: 2, days_late: 1, days_absent: 1 }, unknown: 0 },
      });
    });

    it("импорт организации B не затронут; сотрудник другой организации и связанный с другой компанией не пишутся, даже если они в T12", async () => {
      const a = await world();
      const b = await world();
      // Сотрудник организации B связан с той же компанией и тем же id, что приходит в T12 организации A
      const eTrap = await mkEmp(b.t, { company: a.company, id: 77 });
      const eB = await mkEmp(b.t, { company: b.company, id: 1 });
      const eA = await mkEmp(a.t, { company: a.company, id: 1 });
      // Сотрудник A, связанный с чужой компанией
      const eOtherCo = await mkEmp(a.t, { company: newCompany(), id: 78 });

      // Организация B — прямым вызовом runAttendance (автора нет)
      const resB = await att.runAttendance(
        db,
        fakeClient(b.company, { employees: [wEmp(1)], t12: [t12(1, [tday("2026-10-03", { work_time: "08:00" })])] }),
        { id: b.org },
        P,
        null
      );
      expect(resB).toEqual({ import_id: expect.any(String), days: 1, unknown: 0, carried: 0 });
      const bDays = await daysOf(eB);
      expect(bDays.map((d) => [d.day, d.import_id])).toEqual([["2026-10-03", resB.import_id]]);

      const rich = (id: number) => t12(id, [tday("2026-10-01", { work_time: "08:00" }), tday("2026-10-02")]);
      const resA = await sync(
        a.org,
        fakeClient(a.company, {
          employees: [wEmp(1), wEmp(77), wEmp(78)],
          t12: [rich(1), rich(77), rich(78)],
          absence: [absent(1, "2026-10-02"), absent(77, "2026-10-02"), absent(78, "2026-10-02")],
        })
      );
      expect(resA.run).toMatchObject({ status: "applied", counts: { days: 2, unknown: 0, carried: 0 } });
      expect((await daysOf(eA)).map((d) => [d.day, d.absent])).toEqual([
        ["2026-10-01", false],
        ["2026-10-02", true],
      ]);
      expect(await daysOf(eTrap)).toEqual([]);
      expect(await daysOf(eOtherCo)).toEqual([]);

      const [impB] = await importsOf(b.org, P);
      expect(impB).toMatchObject({ id: resB.import_id, status: "committed", uploaded_by: null });
      expect(await daysOf(eB)).toEqual(bDays);
    });

    it("месяц закрыли между постановкой и выполнением: failed/period_closed из записи, прежний импорт и дни целы", async () => {
      const PS = "2026-09-01";
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const data: Data = { employees: [wEmp(1)], t12: [t12(1, [tday("2026-09-01", { work_time: "08:00" })])] };
      const first = await sync(w.org, fakeClient(w.company, data), PS);
      expect(first.run).toMatchObject({ status: "applied", counts: { days: 1 } });
      const before = await daysOf(eA);

      // Месяц закрывают, пока идёт обход: проверка до обхода уже пройдена
      const closing = fakeClient(
        w.company,
        { ...data, absence: [absent(1, "2026-09-02")] },
        {
          before: {
            absence: async () => {
              await db
                .insert(kpi_periods)
                .values({ period: PS, status: "closed" })
                .onConflictDoUpdate({ target: kpi_periods.period, set: { status: "closed" } });
            },
          },
        }
      );
      const { value: second, logged } = await quietly(() => sync(w.org, closing, PS));
      expect(second.run).toMatchObject({ status: "failed", error: "period_closed", applied_at: null });
      expect(closing.calls.map((c) => c.method)).toContain("absence");
      expect(logged).toContain("period_closed");
      expect((await importsOf(w.org, PS)).map((i) => [i.id, i.status])).toEqual([[importOf(first.run), "committed"]]);
      expect(await daysOf(eA)).toEqual(before);
    });

    it("executeRun: закрытый месяц — failed/period_closed, месяц без прошедших дней — failed/period_not_started; отчёты не запрашиваются", async () => {
      const w = await world();
      await mkEmp(w.t, { company: w.company, id: 1 });
      await db.insert(kpi_periods).values({ period: "2026-07-01", status: "closed" });
      const data: Data = { employees: [wEmp(1)], t12: [t12(1, [tday("2026-07-01", { work_time: "08:00" })])] };

      const closed = fakeClient(w.company, data);
      const future = fakeClient(w.company, data);
      const { value } = await quietly(async () => [await sync(w.org, closed, "2026-07-01"), await sync(w.org, future, "2026-11-01")]);
      expect(value[0].run).toMatchObject({ status: "failed", error: "period_closed" });
      expect(value[1].run).toMatchObject({ status: "failed", error: "period_not_started" });
      for (const c of [closed, future]) expect(c.calls.map((x) => x.method)).not.toContain("t12");
      expect(await importsOf(w.org, "2026-07-01")).toEqual([]);
      expect(await importsOf(w.org, "2026-11-01")).toEqual([]);
    });

    it("сбой Workly — failed с кодом клиента, прочая ошибка — crawl_failed; текст ошибки не пишется ни в строку, ни в лог; прежний импорт цел", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const data: Data = { employees: [wEmp(1)], t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })])] };
      const first = await sync(w.org, fakeClient(w.company, data));
      const before = await daysOf(eA);

      const { value, logged } = await quietly(async () => [
        await sync(w.org, fakeClient(w.company, data, { fail: { method: "t12", error: new WorklyError("http_error", "secret-xyz") } })),
        await sync(w.org, fakeClient(w.company, data, { fail: { method: "lateIn", error: new Error("boom secret-abc") } })),
      ]);
      expect(value[0].run).toMatchObject({ status: "failed", error: "http_error", counts: {} });
      expect(value[1].run).toMatchObject({ status: "failed", error: "crawl_failed", counts: {} });
      expect(logged).not.toContain("secret");
      expect((await importsOf(w.org, P)).map((i) => [i.id, i.status])).toEqual([[importOf(first.run), "committed"]]);
      expect(await daysOf(eA)).toEqual(before);
    });

    it("company_mismatch: учётка другой компании — failed до обхода отчётов, прежний импорт и дни целы, нового импорта нет", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const data: Data = { employees: [wEmp(1)], t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })])] };
      const first = await sync(w.org, fakeClient(w.company, data));
      expect(first.run.status).toBe("applied");
      const before = await daysOf(eA);

      const foreign = fakeClient(w.company + 1, { employees: [wEmp(1)], t12: [t12(1, [tday("2026-10-02", { work_time: "08:00" })])] });
      config.setExpectedCompanyResolver((key) => (key === "LES" ? w.company : null));
      let second: Awaited<ReturnType<typeof sync>>;
      try {
        second = (await quietly(() => sync(w.org, foreign))).value;
      } finally {
        config.setExpectedCompanyResolver(() => null);
      }
      expect(second.run).toMatchObject({ status: "failed", error: "company_mismatch", counts: {}, applied_at: null });
      expect((await rawRun(second.run_id)).workly_company_id).toBeNull();
      expect(foreign.calls.map((c) => c.method)).toEqual(["companyId"]);
      expect((await importsOf(w.org, P)).map((i) => [i.id, i.status])).toEqual([[importOf(first.run), "committed"]]);
      expect(await daysOf(eA)).toEqual(before);
    });

    // ---------- пустой обход ----------

    it("empty_crawl: T12 пуст при непустом списке — failed, прежний api-импорт committed, дни целы, нового импорта нет", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const eB = await mkEmp(w.t, { company: w.company, id: 2 });
      const first = await sync(
        w.org,
        fakeClient(w.company, {
          employees: [wEmp(1), wEmp(2)],
          t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })]), t12(2, [tday("2026-10-02")])],
          absence: [absent(2, "2026-10-02")],
        })
      );
      expect(first.run).toMatchObject({ status: "applied", counts: { days: 2 } });
      const before = [await daysOf(eA), await daysOf(eB)];

      const empty = fakeClient(w.company, { employees: [wEmp(1), wEmp(2)], t12: [], absence: [absent(2, "2026-10-03")] });
      const { value: second, logged } = await quietly(() => sync(w.org, empty));
      expect(second.run).toMatchObject({ status: "failed", error: "empty_crawl", counts: {}, applied_at: null });
      expect(logged).toContain("empty_crawl");
      // Пустой T12 останавливает обход до остальных отчётов
      expect(empty.calls.map((c) => c.method)).not.toContain("absence");
      expect((await importsOf(w.org, P)).map((i) => [i.id, i.status])).toEqual([[importOf(first.run), "committed"]]);
      expect([await daysOf(eA), await daysOf(eB)]).toEqual(before);
      // Прямой вызов — тот же отказ
      await expect(att.runAttendance(db, fakeClient(w.company, { employees: [wEmp(1)] }), { id: w.org }, P, null)).rejects.toMatchObject({
        status: 422,
        code: "empty_crawl",
      });
    });

    it("empty_crawl: в T12 никого из связанных сотрудников организации и переносить нечего — failed, файловый импорт не заменён", async () => {
      const w = await world();
      const eLoose = await mkEmp(w.t, null);
      // Связан с другой компанией тем же id, что приходит в T12: отфильтрован
      await mkEmp(w.t, { company: newCompany(), id: 5 });
      const fileImp = await db.transaction((tx) =>
        writeAttendanceImport(tx, {
          period: P,
          organization_id: w.org,
          file_name: "workly.xlsx",
          uploaded_by: null,
          mapping: { sheet: "Лист1", header_row: 1, mapping: { external_id: 0, date: 1 }, totals: { days_present: 1, days_late: 0, days_absent: 0 } },
          days: [{ employee_id: eLoose, day: "2026-10-02", terminal_id: w.t, check_in: null, check_out: null, late_minutes: 0, absent: false }],
          rows_total: 1,
          rows_unmatched: 0,
          unmatched: [],
        })
      );
      const before = await daysOf(eLoose);

      const client = fakeClient(w.company, {
        employees: [wEmp(5)],
        t12: [t12(5, [tday("2026-10-01", { work_time: "08:00" }), tday("2026-10-02")])],
        absence: [absent(5, "2026-10-02")],
      });
      const { value: run } = await quietly(() => sync(w.org, client));
      expect(run.run).toMatchObject({ status: "failed", error: "empty_crawl", counts: {} });
      expect(client.calls.map((c) => c.method)).toContain("absence");
      expect((await importsOf(w.org, P)).map((i) => [i.id, i.status])).toEqual([[fileImp.id, "committed"]]);
      expect(await daysOf(eLoose)).toEqual(before);
    });

    it("охрана пустого обхода не мешает обычному прогону и прогону только с переносом", async () => {
      const w = await world();
      const eA = await mkEmp(w.t, { company: w.company, id: 1 });
      const eGone = await mkEmp(w.t, { company: w.company, id: 3 }, false);
      const first = await sync(
        w.org,
        fakeClient(w.company, {
          employees: [wEmp(1), wEmp(3)],
          t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })]), t12(3, [tday("2026-10-01")])],
          absence: [absent(3, "2026-10-01")],
        })
      );
      expect(first.run).toMatchObject({ status: "applied", counts: { days: 2, carried: 0 } });

      // Свежих дней нет (у единственного человека в T12 report: null), но есть что перенести
      const second = await sync(w.org, fakeClient(w.company, { employees: [wEmp(1)], t12: [t12(1, null)] }));
      expect(second.run).toMatchObject({ status: "applied", counts: { days: 1, unknown: 0, carried: 1 } });
      expect((await daysOf(eGone)).map((d) => [d.day, d.absent, d.import_id])).toEqual([["2026-10-01", true, importOf(second.run)]]);
      expect(await daysOf(eA)).toEqual([]);
    });

    // ---------- перенос и граница организаций ----------
    // Три расстановки держат по отдельности оба условия выборки переносимых дней:
    // организация импорта (kpi_attendance_imports.organization_id) и нынешняя организация
    // сотрудника (terminals.organization_id). Во всех трёх сотрудник связан с компанией
    // организации A, а его workly_id в отчётах A нет, так что фильтр компании его не отсекает.

    // Файловый импорт организации за месяц с одним днём сотрудника.
    const fileImport = (org: string, employee_id: string, terminal_id: string, day: string) =>
      db.transaction((tx) =>
        writeAttendanceImport(tx, {
          period: P,
          organization_id: org,
          file_name: "workly.xlsx",
          uploaded_by: null,
          mapping: { sheet: "Лист1", header_row: 1, mapping: { external_id: 0, date: 1 }, totals: { days_present: 1, days_late: 0, days_absent: 0 } },
          days: [{ employee_id, day, terminal_id, check_in: null, check_out: null, late_minutes: 0, absent: false }],
          rows_total: 1,
          rows_unmatched: 0,
          unmatched: [],
        })
      );
    // Обычный человек организации A, чтобы прогон не был пустым.
    const presentA = (company: number) =>
      fakeClient(company, { employees: [wEmp(1)], t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })])] });
    const importDaysOf = async (importId: string) =>
      (await db.select().from(kpi_attendance).where(eq(kpi_attendance.import_id, importId))).map((d) => d.employee_id);

    it("перенос: сотрудник другой организации со связью на ту же компанию не переносится и сохраняет свой импорт", async () => {
      const a = await world();
      const b = await world();
      const eA = await mkEmp(a.t, { company: a.company, id: 1 });
      // Сотрудник B связан с компанией A id, которого в отчётах A нет
      const eB = await mkEmp(b.t, { company: a.company, id: 88 });
      const impB = await fileImport(b.org, eB, b.t, "2026-10-02");
      const before = await daysOf(eB);
      expect(before.map((d) => d.import_id)).toEqual([impB.id]);

      const runA = await sync(a.org, presentA(a.company));
      expect(runA.run).toMatchObject({ status: "applied", counts: { days: 1, carried: 0 } });
      expect(await daysOf(eB)).toEqual(before);
      expect((await importsOf(b.org, P)).map((i) => [i.id, i.status])).toEqual([[impB.id, "committed"]]);
      expect(await importDaysOf(importOf(runA.run))).toEqual([eA]);
    });

    it("перенос: день из импорта другой организации не переносится, даже если сотрудник теперь в этой организации", async () => {
      const a = await world();
      const b = await world();
      const eA = await mkEmp(a.t, { company: a.company, id: 1 });
      // День записан импортом B, пока сотрудник был в B; теперь он в A и связан с компанией A
      const eX = await mkEmp(b.t, { company: a.company, id: 90 });
      const impB = await fileImport(b.org, eX, b.t, "2026-10-02");
      await db.update(employees).set({ terminal_id: a.t }).where(eq(employees.id, eX));
      const before = await daysOf(eX);
      expect(before.map((d) => d.import_id)).toEqual([impB.id]);

      const runA = await sync(a.org, presentA(a.company));
      expect(runA.run).toMatchObject({ status: "applied", counts: { days: 1, carried: 0 } });
      expect(await daysOf(eX)).toEqual(before);
      expect((await importsOf(b.org, P)).map((i) => [i.id, i.status])).toEqual([[impB.id, "committed"]]);
      expect(await importDaysOf(importOf(runA.run))).toEqual([eA]);
    });

    it("перенос: сотрудник, ушедший в другую организацию, не переносится из прежнего импорта этой организации", async () => {
      const a = await world();
      const b = await world();
      const eA = await mkEmp(a.t, { company: a.company, id: 1 });
      const eMoved = await mkEmp(a.t, { company: a.company, id: 89 });
      const first = await sync(
        a.org,
        fakeClient(a.company, {
          employees: [wEmp(1), wEmp(89)],
          t12: [t12(1, [tday("2026-10-01", { work_time: "08:00" })]), t12(89, [tday("2026-10-01", { work_time: "08:00" })])],
        })
      );
      expect((await daysOf(eMoved)).map((d) => d.import_id)).toEqual([importOf(first.run)]);
      // Сотрудник ушёл в B; в отчётах A его больше нет
      await db.update(employees).set({ terminal_id: b.t }).where(eq(employees.id, eMoved));

      const second = await sync(a.org, presentA(a.company));
      expect(second.run).toMatchObject({ status: "applied", counts: { days: 1, carried: 0 } });
      expect(await importDaysOf(importOf(second.run))).toEqual([eA]);
      expect(await daysOf(eMoved)).toEqual([]);
    });
  });
}
