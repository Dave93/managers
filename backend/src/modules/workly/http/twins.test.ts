import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// Тот же guard, что в workly/http/attendance.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/twins (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error("workly/http/twins.test.ts: DATABASE_URL не указывает на managers_tickets_test. Гоняйте тесты через bun run test:http:workly.");
  }

  const { cleanupKpi, makeTerminal, setup } = await import("../../kpi/http/fixtures");
  const { employee_twins, employees, kpi_attendance, kpi_attendance_imports, organization } = await import("backend/drizzle/schema");
  const { WorklyError } = await import("../client");
  const config = await import("../config");
  const twins = await import("../twins");
  type Person = import("../twins").TwinPerson;

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;
  const redis = {} as unknown as Redis;
  const hex = () => randomUUID().replace(/-/g, "").slice(0, 8);
  const newCompany = () => 500_000_000 + Math.floor(Math.random() * 100_000_000);
  const KEYS = ["LES", "CHOPAR"] as const;

  type Fake = { companyId: () => Promise<number>; employees: () => Promise<Person[]> };
  const fake = (company: number, people: Person[], o: { failCompany?: unknown } = {}): Fake => ({
    companyId: async () => {
      if (o.failCompany) throw o.failCompany;
      return company;
    },
    employees: async () => people,
  });
  const P = (id: number, last: string, first: string, birth: string | null = "1990-05-01", patronymic: string | null = null): Person => ({
    id,
    last_name: last,
    first_name: first,
    patronymic,
    birth_date: birth,
  });

  // Организация, филиал и связанный сотрудник; имя «Тест …» чистит cleanupKpi.
  async function org() {
    const [o] = await db.insert(organization).values({ name: `wl_test_tw_${hex()}` }).returning({ id: organization.id });
    return { id: o.id, terminal: (await makeTerminal(db, { organization_id: o.id })).id };
  }
  async function emp(o: { terminal: string }, company: number, wid: number, active = true): Promise<string> {
    const [r] = await db
      .insert(employees)
      .values({ first_name: "Тест", last_name: "T" + hex(), terminal_id: o.terminal, active, workly_company_id: company, workly_id: wid })
      .returning({ id: employees.id });
    return r.id;
  }
  const run = (a: Fake, b: Fake) => twins.syncTwins(db, redis, (key) => (key === "LES" ? a : b) as never);
  const rows = () => db.select().from(employee_twins);

  async function world() {
    const cLes = newCompany();
    const cCho = newCompany();
    const oLes = await org();
    const oCho = await org();
    return { cLes, cCho, oLes, oCho };
  }

  const saved: Record<string, string | undefined> = {};
  const ENV = ["WORKLY_BASE_URL", "WORKLY_TWINS", ...KEYS.flatMap((k) => [`WORKLY_${k}_CLIENT_ID`, `WORKLY_${k}_CLIENT_SECRET`, `WORKLY_${k}_USERNAME`, `WORKLY_${k}_PASSWORD`])];

  describe("workly: двойники между компаниями (syncTwins, runTwinsJob)", () => {
    beforeAll(async () => {
      ({ db } = await setup());
      for (const k of ENV) saved[k] = process.env[k];
      process.env.WORKLY_BASE_URL = "https://workly.invalid";
      for (const k of KEYS) {
        process.env[`WORKLY_${k}_CLIENT_ID`] = "id";
        process.env[`WORKLY_${k}_CLIENT_SECRET`] = "secret";
        process.env[`WORKLY_${k}_USERNAME`] = "user";
        process.env[`WORKLY_${k}_PASSWORD`] = "pass";
      }
      delete process.env.WORKLY_TWINS;
      // Подставные клиенты отдают случайные номера компаний: сверка компании выключена.
      config.setExpectedCompanyResolver(() => null);
    }, 180000);

    beforeEach(async () => {
      await cleanupKpi(db);
    });

    afterAll(async () => {
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      config.setExpectedCompanyResolver(null);
      await cleanupKpi(db);
    });

    it("точное имя и одинаковая дата рождения: пара создаётся, повторный запуск ничего не меняет; порядок id в строке a < b", async () => {
      const w = await world();
      const a = await emp(w.oLes, w.cLes, 1);
      const b = await emp(w.oCho, w.cCho, 11);
      const ps = fake(w.cLes, [P(1, "Karimov", "Bobur"), P(2, "Alone", "Les")]);
      const pc = fake(w.cCho, [P(11, "KARIMOV", "bobur"), P(12, "Alone", "Chopar", "1999-01-01")]);
      const first = await run(ps, pc);
      expect(first).toMatchObject({ status: "ok", pairs: 1, added: 1, updated: 0, removed: 0, ambiguous: 0, rejected_overlap: 0, unlinked: 0 });
      const [row] = await rows();
      expect(row).toMatchObject({ rule: "name_birth", blocked: false });
      expect([row!.employee_a, row!.employee_b].sort()).toEqual([a, b].sort());
      expect(row!.employee_a < row!.employee_b).toBe(true);
      expect(await run(ps, pc)).toMatchObject({ pairs: 1, added: 0, updated: 0, removed: 0 });
      expect(await rows()).toHaveLength(1);
    });

    it("name_only: даты разные, в один день обе записи не отмечались — пара; отмечались вместе — отказ (тёзки)", async () => {
      const w = await world();
      const a = await emp(w.oLes, w.cLes, 1);
      const b = await emp(w.oCho, w.cCho, 11);
      const ps = fake(w.cLes, [P(1, "Karimov", "Bobur", "1990-05-01")]);
      const pc = fake(w.cCho, [P(11, "Karimov", "Bobur", "1990-05-09")]);
      expect(await run(ps, pc)).toMatchObject({ pairs: 1, added: 1 });
      expect((await rows())[0]).toMatchObject({ rule: "name_only" });

      // Теперь у обоих есть отметка присутствия в один и тот же день текущего месяца: пара пропадает
      const day = new Date().toISOString().slice(0, 10);
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: `${day.slice(0, 7)}-01`, file_name: "twins", uploaded_by: randomUUID(), mapping: {}, rows_total: 2, rows_matched: 2 })
        .returning({ id: kpi_attendance_imports.id });
      for (const id of [a, b]) await db.insert(kpi_attendance).values({ employee_id: id, day, terminal_id: w.oLes.terminal, late_minutes: 0, absent: false, import_id: imp.id });
      const second = await run(ps, pc);
      expect(second).toMatchObject({ pairs: 0, rejected_overlap: 1, removed: 1 });
      expect(await rows()).toHaveLength(0);
    });

    it("разорванная человеком пара (blocked) не трогается и заново не создаётся", async () => {
      const w = await world();
      const a = await emp(w.oLes, w.cLes, 1);
      const b = await emp(w.oCho, w.cCho, 11);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      await db.insert(employee_twins).values({ employee_a: lo, employee_b: hi, rule: "name_only", blocked: true });
      const res = await run(fake(w.cLes, [P(1, "Karimov", "Bobur")]), fake(w.cCho, [P(11, "Karimov", "Bobur")]));
      expect(res).toMatchObject({ status: "ok", pairs: 1, added: 0, updated: 0, removed: 0, kept_blocked: 1 });
      expect(await rows()).toMatchObject([{ blocked: true, rule: "name_only" }]);
      // И когда имена перестали совпадать, разорванную строку тоже не удаляем
      await run(fake(w.cLes, [P(1, "Karimov", "Bobur")]), fake(w.cCho, [P(11, "Other", "Person")]));
      expect(await rows()).toHaveLength(1);
    });

    it("пропавшее совпадение удаляет пару; неоднозначные, несвязанные у нас и неактивные пропускаются со счётом", async () => {
      const w = await world();
      await emp(w.oLes, w.cLes, 1);
      await emp(w.oCho, w.cCho, 11);
      // Неоднозначная: у Les двое Saidov Anvar с датой, у Chopar один
      await emp(w.oLes, w.cLes, 3);
      await emp(w.oLes, w.cLes, 4);
      await emp(w.oCho, w.cCho, 13);
      // Несвязанная у нас (в Workly есть, строки employees нет) и неактивная
      await emp(w.oLes, w.cLes, 5, false);
      await emp(w.oCho, w.cCho, 15);
      const lesPeople = [P(1, "Karimov", "Bobur"), P(3, "Saidov", "Anvar", "1980-01-01"), P(4, "Saidov", "Anvar", "1980-01-01"), P(5, "Rahimov", "Jasur", "1985-02-02"), P(6, "Ghost", "Person", "1970-01-01")];
      const choPeople = [P(11, "Karimov", "Bobur"), P(13, "Saidov", "Anvar", "1980-01-01"), P(15, "Rahimov", "Jasur", "1985-02-02"), P(16, "Ghost", "Person", "1970-01-01")];
      const res = await run(fake(w.cLes, lesPeople), fake(w.cCho, choPeople));
      expect(res).toMatchObject({ status: "ok", pairs: 1, added: 1, ambiguous: 2, unlinked: 2 });
      // Совпадение пропало: пара удалена
      const gone = await run(fake(w.cLes, [P(1, "Karimov", "Bobur")]), fake(w.cCho, [P(11, "Different", "Name")]));
      expect(gone).toMatchObject({ pairs: 0, removed: 1, remove_skipped: false });
      expect(await rows()).toHaveLength(0);
    });

    it("сбой списка не стирает таблицу: пустой ответ даёт skipped; массовое удаление (больше половины) пропускается", async () => {
      const w = await world();
      const names = ["Aaa", "Bbb", "Ccc", "Ddd", "Eee"].map((n, i) => ({ n: n + "ov", id: 100 + i }));
      const lesPeople: Person[] = [];
      const choPeople: Person[] = [];
      for (const x of names) {
        await emp(w.oLes, w.cLes, x.id);
        await emp(w.oCho, w.cCho, x.id + 1000);
        lesPeople.push(P(x.id, x.n, "Name"));
        choPeople.push(P(x.id + 1000, x.n, "Name"));
      }
      expect(await run(fake(w.cLes, lesPeople), fake(w.cCho, choPeople))).toMatchObject({ pairs: 5, added: 5 });
      // Пустой список одной компании: ничего не удаляется
      expect(await run(fake(w.cLes, lesPeople), fake(w.cCho, []))).toMatchObject({ status: "skipped", removed: 0 });
      expect(await rows()).toHaveLength(5);
      // Имена всех пяти перестали совпадать: пять удалений при потолке max(3, 3) = 3 — пропуск и тревога в логе
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        const res = await twins.runTwinsJob(db, redis, (key) => (key === "LES" ? fake(w.cLes, lesPeople) : fake(w.cCho, choPeople.map((p) => ({ ...p, last_name: "Zzz" + p.id })))) as never);
        expect(res).toMatchObject({ status: "ok", removed: 0, remove_skipped: true });
        expect(spy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("workly twins remove_skipped");
      } finally {
        spy.mockRestore();
      }
      expect(await rows()).toHaveLength(5);
    });

    it("runTwinsJob: выключатель, нет настроек, сбой Workly — только код в логе и таблица цела", async () => {
      const w = await world();
      const spy = spyOn(console, "error").mockImplementation(() => {});
      try {
        process.env.WORKLY_TWINS = "0";
        expect(await twins.runTwinsJob(db, redis, () => ({}) as never)).toEqual({ status: "disabled" });
        delete process.env.WORKLY_TWINS;

        const secret = process.env.WORKLY_CHOPAR_CLIENT_SECRET;
        delete process.env.WORKLY_CHOPAR_CLIENT_SECRET;
        expect(await twins.runTwinsJob(db, redis, () => ({}) as never)).toMatchObject({ status: "skipped" });
        process.env.WORKLY_CHOPAR_CLIENT_SECRET = secret;

        const bad = fake(w.cLes, [P(1, "A", "B")], { failCompany: new WorklyError("http_error", "сеть упала: секретный текст") });
        const res = await twins.runTwinsJob(db, redis, () => bad as never);
        expect(res).toMatchObject({ status: "error", added: 0 });
        const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(logged).toContain("workly twins - http_error");
        expect(logged).not.toContain("секретный текст");
      } finally {
        spy.mockRestore();
        delete process.env.WORKLY_TWINS;
      }
      expect(await rows()).toHaveLength(0);
    });
  });
}
