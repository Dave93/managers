import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

// Тот же guard, что в tg-app-home.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app attendance (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeUser, setNow, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports, kpi_days_off } = await import("backend/drizzle/schema");
  const { randomUUID } = await import("node:crypto");
  const { sql } = await import("drizzle-orm");
  const { setTestBotApi } = await import("../tg/bot-api");

  const login = async (b: { telegram_id: number }) => (await tgLogin(b.telegram_id)).body.token as string;
  type Day = { day: string; check_in?: string; check_out?: string; late_minutes?: number; absent?: boolean };
  const row = (d: Day) => ({ day: d.day, check_in: d.check_in ?? null, check_out: d.check_out ?? null, late_minutes: d.late_minutes ?? 0, absent: d.absent ?? false });

  describe("kpi: посещаемость в мини-приложении", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;

    // Строки напрямую; родитель-импорт нужен из-за внешнего ключа import_id.
    const seed = async (e: { id: string; terminal_id: string }, days: Day[]) => {
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: `${days[0]!.day.slice(0, 7)}-01`, file_name: "tg-attendance-test", mapping: {}, rows_total: days.length, rows_matched: days.length })
        .returning({ id: kpi_attendance_imports.id });
      await db.insert(kpi_attendance).values(days.map((d) => ({ ...row(d), employee_id: e.id, terminal_id: e.terminal_id, import_id: imp!.id })));
    };
    const sessionOf = async () => {
      const e = await makeEmployee(db, { role_code: "cook" });
      return { e, token: await login(await bindTelegram(db, { employee_id: e.id })) };
    };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
    }, 180000);

    beforeEach(() => {
      setTestBotApi(fakeBotApi().api);
    });

    afterAll(async () => {
      setNow(null);
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("выходной: прогул и день без строки приходят как day_off, присутствие главнее, причина не уходит", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const a = await sessionOf();
      await seed(a.e, [
        { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z" },
        { day: "2026-11-04", absent: true },
        { day: "2026-11-05", check_in: "2026-11-05T04:20:00.000Z", late_minutes: 20 },
      ]);
      const off = (day: string, cancelled = false) => ({
        employee_id: a.e.id, day, terminal_id: a.e.terminal_id, reason_code: "other", reason_text: "семейные дела", given_by: randomUUID(),
        cancelled_at: cancelled ? sql`now()` : null,
      });
      await db.insert(kpi_days_off).values([off("2026-11-04"), off("2026-11-05"), off("2026-11-06"), off("2026-11-07", true)]);
      const r = await tgApi(a.token, "GET", "/api/kpi/tg/attendance?month=2026-11");
      expect(r.status).toBe(200);
      expect(r.body.days).toEqual([
        { day: "2026-11-06", check_in: null, check_out: null, late_minutes: 0, absent: false, day_off: true },
        { day: "2026-11-05", check_in: "2026-11-05T04:20:00.000Z", check_out: null, late_minutes: 20, absent: false, day_off: false },
        { day: "2026-11-04", check_in: null, check_out: null, late_minutes: 0, absent: false, day_off: true },
        { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z", late_minutes: 0, absent: false, day_off: false },
      ]);
      // Сотрудник не видит ни причину, ни автора.
      expect(JSON.stringify(r.body)).not.toMatch(/reason|given_by|семейные|other/);
    });

    it("только свои дни: строки другого сотрудника того же месяца не приходят, чужой employee_id в запросе игнорируется", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const a = await sessionOf();
      const b = await sessionOf();
      await seed(a.e, [
        { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z" },
        { day: "2026-11-04", absent: true },
      ]);
      await seed(b.e, [
        { day: "2026-11-03", check_in: "2026-11-03T04:40:00.000Z", check_out: "2026-11-03T13:30:00.000Z", late_minutes: 45 },
        { day: "2026-11-05", check_in: "2026-11-05T04:00:00.000Z" },
      ]);
      const ra = await tgApi(a.token, "GET", `/api/kpi/tg/attendance?month=2026-11&employee_id=${b.e.id}`);
      expect(ra).toEqual({
        status: 200,
        body: {
          month: "2026-11", prev: null, next: null,
          days: [
            { day: "2026-11-04", check_in: null, check_out: null, late_minutes: 0, absent: true, day_off: false },
            { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z", late_minutes: 0, absent: false, day_off: false },
          ],
        },
      });
      const rb = await tgApi(b.token, "GET", "/api/kpi/tg/attendance?month=2026-11");
      expect(rb.body.days).toEqual([
        { day: "2026-11-05", check_in: "2026-11-05T04:00:00.000Z", check_out: null, late_minutes: 0, absent: false, day_off: false },
        { day: "2026-11-03", check_in: "2026-11-03T04:40:00.000Z", check_out: "2026-11-03T13:30:00.000Z", late_minutes: 45, absent: false, day_off: false },
      ]);
    });

    it("не сотрудник и без сессии: 403 not_employee и 401", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const u = await makeUser(db);
      const token = await login(await bindTelegram(db, { user_id: u.id }));
      expect(await tgApi(token, "GET", "/api/kpi/tg/attendance")).toEqual({ status: 403, body: { error: "not_employee" } });
      expect(await tgApi(null, "GET", "/api/kpi/tg/attendance")).toEqual({ status: 401, body: { error: "unauthorized" } });
    });

    it("месяц по Ташкенту: в 20:00 UTC 31 октября уже ноябрь, день 31 октября и ночной уход остаются в октябре", async () => {
      setNow("2026-10-31T20:00:00Z");
      const { e, token } = await sessionOf();
      await seed(e, [
        { day: "2026-09-30", absent: true },
        { day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z" },
        { day: "2026-11-01", check_in: "2026-11-01T03:00:00.000Z" },
      ]);
      expect((await tgApi(token, "GET", "/api/kpi/tg/attendance")).body).toEqual({
        month: "2026-11", prev: "2026-10", next: null,
        days: [{ day: "2026-11-01", check_in: "2026-11-01T03:00:00.000Z", check_out: null, late_minutes: 0, absent: false, day_off: false }],
      });
      expect((await tgApi(token, "GET", "/api/kpi/tg/attendance?month=2026-10")).body).toEqual({
        month: "2026-10", prev: "2026-09", next: "2026-11",
        days: [{ day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z", late_minutes: 0, absent: false, day_off: false }],
      });
    });

    it("месяц без строк: 200, пустые days, переключатель ведёт к ближайшим месяцам со строками", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const { e, token } = await sessionOf();
      await seed(e, [{ day: "2026-06-15", absent: true }, { day: "2026-08-20", absent: true }]);
      const get = async (q: string) => (await tgApi(token, "GET", `/api/kpi/tg/attendance${q}`)).body;
      expect(await get("")).toEqual({ month: "2026-11", prev: "2026-08", next: null, days: [] });
      expect(await get("?month=2026-07")).toEqual({ month: "2026-07", prev: "2026-06", next: "2026-08", days: [] });
      const aug = await get("?month=2026-08");
      expect([aug.prev, aug.next, aug.days.length]).toEqual(["2026-06", "2026-11", 1]);
      const fresh = await sessionOf();
      expect((await tgApi(fresh.token, "GET", "/api/kpi/tg/attendance")).body).toEqual({ month: "2026-11", prev: null, next: null, days: [] });
    });

    it("кривой месяц: 422 bad_period", async () => {
      const { token } = await sessionOf();
      for (const bad of ["2026-13", "2026-00", "2026-11-01", "2026-1", "26-11", "", "abc", "0000-01", "0050-06", "0001-01"]) {
        expect(await tgApi(token, "GET", `/api/kpi/tg/attendance?month=${bad}`)).toEqual({ status: 422, body: { error: "bad_period" } });
      }
      // Повтор параметра Elysia сводит к последнему значению (массива в обработчик не приходит): это обычный запрос за месяц.
      const repeated = await tgApi(token, "GET", "/api/kpi/tg/attendance?month=2026-11&month=2026-10");
      expect([repeated.status, repeated.body.month]).toEqual([200, "2026-10"]);
      expect(await tgApi(token, "GET", "/api/kpi/tg/attendance?month=2026-10&month=abc")).toEqual({ status: 422, body: { error: "bad_period" } });
    });
  });
}
