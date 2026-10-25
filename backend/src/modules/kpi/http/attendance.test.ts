import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/attendance (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { ATT_HEAD, ATT_MAP, api, cleanupKpi, expectIsoTimestamps, importAttendance, makeEmployee, setup, uploadAttendance, xlsxFile } = await import("./fixtures");
  const { kpi_attendance, kpi_periods } = await import("backend/drizzle/schema");
  const { getRedisClient } = await import("backend/src/lib/shared-instances");
  const { asc, eq } = await import("drizzle-orm");
  const XLSX = await import("xlsx");
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P9 = "2025-09-01";

  // Кириллица в windows-1251: А..я → 0xC0..0xFF, остальное ASCII.
  const cp1251 = (s: string) =>
    Uint8Array.from(
      [...s].map((ch) => {
        const c = ch.codePointAt(0)!;
        if (c < 0x80) return c;
        if (c >= 0x410 && c <= 0x44f) return c - 0x350;
        throw new Error(`нет в тесте: ${ch}`);
      })
    );

  describe("kpi: импорт Workly", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    const ext = () => "T-" + randomUUID().slice(0, 8);
    const commit = (s: Session | null, b: unknown) => api(s, "POST", "/api/kpi/attendance/commit", b);
    const imports = async (s: Session) => (await api(s, "GET", `/api/kpi/attendance/imports?period=${P9}`)).body;
    const hrSession = () => withSession({ permissions: ["kpi.manage"] });

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("права: без сессии — 401; view, evaluate, approve — 403", async () => {
      expect((await uploadAttendance(null, xlsxFile([ATT_HEAD]))).status).toBe(401);
      const v = await withSession({ permissions: ["kpi.view", "kpi.evaluate", "kpi.approve"] });
      expect((await uploadAttendance(v, xlsxFile([ATT_HEAD]))).status).toBe(403);
      expect((await commit(v, {})).status).toBe(403);
      expect((await api(v, "GET", `/api/kpi/attendance/imports?period=${P9}`)).status).toBe(403);
    });

    it("parse: листы, строка заголовков, 20 строк, файл живёт 30 минут", async () => {
      const hr = await hrSession();
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Сводка за сентябрь"]]), "Сводка");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["Workly, сентябрь 2025"],
          [],
          ATT_HEAD,
          ...Array.from({ length: 30 }, (_, i) => [`T-${i}`, 45901, "09:00", "18:00", 0, ""]),
        ]),
        "Данные"
      );
      const r = await uploadAttendance(hr, new File([XLSX.write(wb, { type: "buffer", bookType: "xlsx" })], "workly.xlsx"));
      expect(r.status).toBe(200);
      expect(r.body.file_name).toBe("workly.xlsx");
      expect(r.body.sheets.map((s: any) => s.name)).toEqual(["Сводка", "Данные"]);
      expect(r.body.sheets[1]).toMatchObject({ header_row: 3, headers: ATT_HEAD, total_rows: 33 });
      expect(r.body.sheets[1].rows).toHaveLength(20);
      expectIsoTimestamps(r.body, ["expires_at"]);
      const ttl = await getRedisClient().ttl(`${process.env.PROJECT_PREFIX}kpi_attendance_upload:${r.body.token}`);
      expect(ttl).toBeGreaterThan(1700);
      expect(ttl).toBeLessThanOrEqual(1800);
    });

    it("parse: нет файла, не тот тип, больше 5 МБ, мусор", async () => {
      const hr = await hrSession();
      expect((await uploadAttendance(hr, null)).body).toEqual({ error: "file_required" });
      expect((await uploadAttendance(hr, new File(["x"], "a.txt"))).body).toEqual({ error: "bad_file_type" });
      expect((await uploadAttendance(hr, new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv"))).body).toEqual({ error: "file_too_large" });
      expect((await uploadAttendance(hr, new File([new Uint8Array([1, 2, 3, 4])], "a.xlsx"))).body).toEqual({ error: "bad_file" });
      expect((await uploadAttendance(hr, new File([], "empty.csv"))).body).toEqual({ error: "empty_file" });
    });

    it("commit: сопоставление, причины по строкам Excel, время по Ташкенту", async () => {
      const hr = await hrSession();
      const xa = ext(), xb = ext();
      const a = await makeEmployee(db, { external_id: xa });
      const b = await makeEmployee(db, { external_id: xb });
      const r = await importAttendance(hr, [
        [xa, 45901, "09:05", "18:00", 0, ""], // 2
        [xa, 45902, "09:20", "18:00", 15, ""], // 3
        [xa, "03.09.2025", "08:55", null, null, null], // 4
        [xb, 45901, null, null, null, "прогул"], // 5
        ["T-нет-такого", 45901, "09:00", null, 0, ""], // 6
        [xa, "01.10.2025", "09:00", null, 0, ""], // 7
        [xa, 45901, "10:00", null, 60, ""], // 8
        ["", 45903, null, null, null, null], // 9
      ], P9);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ period: P9, sheet: "Лист1", header_row: 1, mapping: ATT_MAP, rows_total: 8, rows_matched: 4, rows_unmatched: 4, status: "committed" });
      expectIsoTimestamps(r.body, ["created_at"]);
      expect(r.body.unmatched).toEqual([
        { row: 6, external_id: "T-нет-такого", reason: "unknown_external_id" },
        { row: 7, external_id: xa, reason: "outside_period" },
        { row: 8, external_id: xa, reason: "duplicate_day" },
        { row: 9, external_id: null, reason: "no_external_id" },
      ]);
      const rows = await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, a.id)).orderBy(asc(kpi_attendance.day));
      expect(rows.map((x) => [x.day, x.late_minutes, x.absent])).toEqual([["2025-09-01", 0, false], ["2025-09-02", 15, false], ["2025-09-03", 0, false]]);
      expect(new Date(rows[0].check_in!).toISOString()).toBe("2025-09-01T04:05:00.000Z");
      expect(rows[0].terminal_id).toBe(a.terminal_id);
      expect(rows[2].check_out).toBeNull();
      const [bRow] = await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, b.id));
      expect(bRow.absent).toBe(true);
      const list = await imports(hr);
      expect(list[0]).toMatchObject({ id: r.body.id, status: "committed", uploaded_by: hr.userId });
      expectIsoTimestamps(list, ["created_at"]);
    });

    it("R6: прогулы, нерабочие дни и дни без отметок; итоги в ответе и в списке", async () => {
      const hr = await hrSession();
      const x = ext();
      const e = await makeEmployee(db, { external_id: x });
      const r = await importAttendance(hr, [
        [x, 45901, "09:00", "18:00", 0, ""], // 2 вовремя
        [x, 45902, "09:20", "18:00", 20, "-"], // 3 опоздание
        [x, 45903, "--:--", "--:--", "—", "Неявка"], // 4 прогул
        [x, 45904, "-", "-", "-", "Выходной"], // 5 not_working_day
        [x, 45905, null, null, null, ""], // 6 no_marks
        [x, 45906, "утро", "--", "много", "Н"], // 7 прогул: время не читается
      ], P9);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ rows_total: 6, rows_matched: 4, rows_unmatched: 2, days_present: 2, days_late: 1, days_absent: 2 });
      expect(r.body.unmatched).toEqual([
        { row: 5, external_id: x, reason: "not_working_day" },
        { row: 6, external_id: x, reason: "no_marks" },
      ]);
      const rows = await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, e.id)).orderBy(asc(kpi_attendance.day));
      expect(rows.map((d) => [d.day, d.absent, d.late_minutes, d.check_in === null, d.check_out === null])).toEqual([
        ["2025-09-01", false, 0, false, false],
        ["2025-09-02", false, 20, false, false],
        ["2025-09-03", true, 0, true, true],
        ["2025-09-06", true, 0, true, true],
      ]);
      const listed = (await imports(hr)).find((i: any) => i.id === r.body.id);
      expect(listed).toMatchObject({ days_present: 2, days_late: 1, days_absent: 2 });
    });

    it("объединённая колонка табельного номера: номер на каждой строке", async () => {
      const hr = await hrSession();
      const x = ext();
      const e = await makeEmployee(db, { external_id: x });
      const ws = XLSX.utils.aoa_to_sheet([
        ATT_HEAD,
        [x, 45901, "09:00", "18:00", 0, ""],
        [null, 45902, "09:00", "18:00", 0, ""],
        [null, 45903, "09:10", "18:00", 10, ""],
      ]);
      ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Лист1");
      const up = await uploadAttendance(hr, new File([XLSX.write(wb, { type: "buffer", bookType: "xlsx" })], "merged.xlsx"));
      expect(up.status).toBe(200);
      const r = await commit(hr, { token: up.body.token, sheet: "Лист1", period: P9, header_row: 1, mapping: ATT_MAP });
      expect(r.body).toMatchObject({ rows_matched: 3, rows_unmatched: 0, days_present: 3, days_late: 1, days_absent: 0 });
      expect(await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, e.id))).toHaveLength(3);
    });

    it("повторный импорт за месяц заменяет прошлый", async () => {
      const hr = await hrSession();
      const xa = ext(), xb = ext();
      const a = await makeEmployee(db, { external_id: xa });
      const b = await makeEmployee(db, { external_id: xb });
      const first = await importAttendance(hr, [[xa, 45901, "09:00", "18:00", 0, ""], [xb, 45901, "09:00", "18:00", 0, ""]], P9);
      const second = await importAttendance(hr, [[xb, 45902, "09:00", "18:00", 0, ""]], P9);
      expect([first.status, second.status]).toEqual([200, 200]);
      const list = await imports(hr);
      expect(list.slice(0, 2).map((x: any) => [x.id, x.status])).toEqual([[second.body.id, "committed"], [first.body.id, "replaced"]]);
      expect(list.filter((x: any) => x.status === "committed")).toHaveLength(1);
      expect(await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, a.id))).toHaveLength(0);
      const bRows = await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, b.id));
      expect(bRows.map((x) => [x.day, x.import_id])).toEqual([["2025-09-02", second.body.id]]);
    });

    it("ничего не сопоставлено — 422 nothing_matched, прошлый импорт остаётся", async () => {
      const hr = await hrSession();
      const x = ext();
      await makeEmployee(db, { external_id: x });
      const ok = await importAttendance(hr, [[x, 45901, "09:00", "18:00", 0, ""]], P9);
      expect(ok.status).toBe(200);
      const before = (await imports(hr)).find((i: any) => i.status === "committed");
      const bad = await importAttendance(hr, [[x, 45901, "09:00", "18:00", 0, ""]], P9, { ...ATT_MAP, external_id: 2 });
      expect(bad.status).toBe(422);
      expect(bad.body).toMatchObject({ error: "nothing_matched", rows_total: 1 });
      expect(bad.body.unmatched[0].reason).toBe("unknown_external_id");
      const after = (await imports(hr)).filter((i: any) => i.status === "committed");
      expect(after.map((i: any) => i.id)).toEqual([before.id]);
      expect(before.id).toBe(ok.body.id);
    });

    it("ошибки ввода", async () => {
      const hr = await hrSession();
      const other = await hrSession();
      const x = ext();
      await makeEmployee(db, { external_id: x });
      const up = await uploadAttendance(hr, xlsxFile([ATT_HEAD, [x, 45901, "09:00", "18:00", 0, ""]]));
      const base = { token: up.body.token, sheet: "Лист1", period: P9, header_row: 1, mapping: ATT_MAP };
      const post = (patch: Record<string, unknown>) => commit(hr, { ...base, ...patch });

      expect(await commit(other, base)).toEqual({ status: 404, body: { error: "upload_expired" } });
      expect((await post({ token: randomUUID() })).body).toEqual({ error: "upload_expired" });
      expect((await post({ token: 5 })).body).toEqual({ error: "upload_expired" });
      expect(await post({ sheet: "Нет" })).toEqual({ status: 422, body: { error: "bad_sheet" } });
      expect(await post({ mapping: { external_id: 0 } })).toEqual({ status: 422, body: { error: "bad_mapping" } });
      expect(await post({ mapping: { ...ATT_MAP, absent: 6 } })).toEqual({ status: 422, body: { error: "bad_mapping" } });
      for (const header_row of [0, 21, 3, 1.5, "1"]) {
        expect(await post({ header_row })).toEqual({ status: 422, body: { error: "bad_header_row" } });
      }
      expect(await post({ period: "2025-09-15" })).toEqual({ status: 422, body: { error: "bad_period" } });
      // строка заголовков не задана — угадывается
      expect((await post({ header_row: undefined })).status).toBe(200);

      await db.insert(kpi_periods).values({ period: "2025-12-01", status: "closed" });
      expect(await importAttendance(hr, [[x, 45901, "09:00", "18:00", 0, ""]], "2025-12-01")).toEqual({ status: 409, body: { error: "period_closed" } });
    });

    it("CSV из Excel: windows-1251, точка с запятой, «02.09.2025» — 2 сентября", async () => {
      const hr = await hrSession();
      const xc = ext();
      const c = await makeEmployee(db, { external_id: xc });
      const csv = cp1251(`${ATT_HEAD.join(";")}\n${xc};02.09.2025;08:59:30;18:00;0;\n`);
      const up = await uploadAttendance(hr, new File([csv], "workly.csv"));
      expect(up.status).toBe(200);
      expect(up.body.sheets[0].headers).toEqual(ATT_HEAD);
      const r = await commit(hr, { token: up.body.token, sheet: up.body.sheets[0].name, period: P9, header_row: 1, mapping: ATT_MAP });
      expect(r.status).toBe(200);
      expect(r.body.rows_matched).toBe(1);
      const [row] = await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, c.id));
      expect(row.day).toBe("2025-09-02");
      expect(new Date(row.check_in!).toISOString()).toBe("2025-09-02T03:59:30.000Z");
    });

    it("табельный номер числом в Excel совпадает с текстом в базе", async () => {
      const hr = await hrSession();
      const num = String(100000000 + Math.floor(Math.random() * 899999999));
      await makeEmployee(db, { external_id: num });
      const r = await importAttendance(hr, [[Number(num), 45901, "09:00", "18:00", 0, ""]], P9);
      expect(r.status).toBe(200);
      expect(r.body.rows_matched).toBe(1);
    });

    it("два одновременных commit одного файла — оба 200, действующий импорт один", async () => {
      const hr = await hrSession();
      const x = ext();
      const e = await makeEmployee(db, { external_id: x });
      const up = await uploadAttendance(hr, xlsxFile([ATT_HEAD, [x, 45901, "09:00", "18:00", 0, ""]]));
      const body = { token: up.body.token, sheet: "Лист1", period: P9, header_row: 1, mapping: ATT_MAP };
      const rs = await Promise.all([commit(hr, body), commit(hr, body)]);
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect((await imports(hr)).filter((i: any) => i.status === "committed")).toHaveLength(1);
      expect(await db.select().from(kpi_attendance).where(eq(kpi_attendance.employee_id, e.id))).toHaveLength(1);
    });
  });
}
