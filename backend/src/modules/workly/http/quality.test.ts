import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в workly/http/locations.test.ts: голый `bun test` пропускает файл,
// запуск через test:http:workly доходит до тестов.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("workly/quality (пропущено: запускайте через bun run test:http:workly)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  if (!dbLooksLikeTest) {
    throw new Error(
      "workly/http/quality.test.ts: DATABASE_URL не указывает на managers_tickets_test. " +
        "Гоняйте тесты через bun run test:http:workly."
    );
  }

  const { cleanupKpi, makeEmployee, makeOrganization, makeTerminal, setup } = await import("../../kpi/http/fixtures");
  const { employees, kpi_attendance, kpi_attendance_imports } = await import("backend/drizzle/schema");
  const { qualityReport } = await import("../quality");
  const { eq } = await import("drizzle-orm");

  type Db = Awaited<ReturnType<typeof setup>>["db"];
  let db: Db;

  // Февраль: 28 дней, поэтому границы месяца не совпадают с «31-м числом».
  const P = "2026-02-01";
  const day = (d: number) => `2026-02-${String(d).padStart(2, "0")}`;

  describe("workly: качество данных, qualityReport", () => {
    let orgA = "";
    let orgB = "";
    let tA1 = { id: "", name: "" };
    let tA2 = { id: "", name: "" };
    let tB1 = { id: "", name: "" };
    // Сотрудники организации A
    let heavyA = "";
    let nearA = "";
    let heavyB = "";
    const nameOf: Record<string, string> = {};
    const ghostB = randomUUID(); // прогульщик без строки в employees

    let importId = "";

    // Строки kpi_attendance одного сотрудника в одном филиале.
    const put = async (terminal_id: string, employee_id: string, list: { day: string; absent: boolean }[]) => {
      if (!list.length) return;
      await db.insert(kpi_attendance).values(list.map((d) => ({ employee_id, terminal_id, day: d.day, absent: d.absent, import_id: importId })));
    };
    // Дни с первого по last: первые `absent` из них — прогулы.
    const span = (last: number, absent: number) => Array.from({ length: last }, (_, i) => ({ day: day(i + 1), absent: i < absent }));

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);

      orgA = await makeOrganization(db);
      orgB = await makeOrganization(db);
      tA1 = await makeTerminal(db, { organization_id: orgA });
      tA2 = await makeTerminal(db, { organization_id: orgA });
      tB1 = await makeTerminal(db, { organization_id: orgB });

      heavyA = (await makeEmployee(db, { terminal_id: tA1.id, first_name: "Тест Анвар" })).id;
      nearA = (await makeEmployee(db, { terminal_id: tA1.id, first_name: "Тест Бобур" })).id;
      heavyB = (await makeEmployee(db, { terminal_id: tB1.id, first_name: "Тест Зафар" })).id;
      for (const id of [heavyA, nearA, heavyB]) {
        const [e] = await db.select().from(employees).where(eq(employees.id, id));
        nameOf[id] = `${e.last_name} ${e.first_name}`;
      }

      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "kpi_test", mapping: {}, rows_total: 0, rows_matched: 0, organization_id: orgA })
        .returning({ id: kpi_attendance_imports.id });
      importId = imp.id;

      // Организация A, филиал 1: прогульщик 10/10, почти прогульщик 9/10, 4/4 (мало дней), здоровый 0/10.
      await put(tA1.id, heavyA, span(10, 10));
      await put(tA1.id, nearA, span(10, 9));
      await put(tA1.id, randomUUID(), span(4, 4));
      await put(tA1.id, randomUUID(), span(10, 0));
      // Филиал 2: 2 прогула из 10 и границы месяца у одного сотрудника.
      await put(tA2.id, randomUUID(), span(10, 2));
      const edge = randomUUID();
      await put(tA2.id, edge, [
        { day: "2026-01-31", absent: true }, // день до месяца: не считается
        { day: day(1), absent: false }, // первый день: считается
        { day: day(28), absent: true }, // последний день: считается
        { day: "2026-03-01", absent: true }, // первый день следующего месяца: не считается
      ]);
      // Организация B: 20 из 20 у настоящего сотрудника и 5 из 5 у «призрака».
      await put(tB1.id, heavyB, span(20, 20));
      await put(tB1.id, ghostB, span(5, 5));
    }, 180000);

    afterAll(async () => {
      await cleanupKpi(db);
    });

    it("считает только строки организации и только за месяц, границы месяца включены", async () => {
      const q = await qualityReport(db, orgA, P);
      // филиал 1: 10 + 10 + 4 + 10 = 34 дня, 10 + 9 + 4 + 0 = 23 прогула
      // филиал 2: 10 + 2 = 12 дней, 2 + 1 = 3 прогула (31 января и 1 марта не в счёте)
      expect(q.branches.map((b) => [b.terminal_id, b.terminal_name, b.days, b.absent])).toEqual([
        [tA1.id, tA1.name, 34, 23],
        [tA2.id, tA2.name, 12, 3],
      ]);
      expect(q.branches[0].share).toBeCloseTo(23 / 34, 10);
      expect(q.branches[1].share).toBeCloseTo(3 / 12, 10);
      expect(q.median).toBeCloseTo((23 / 34 + 3 / 12) / 2, 10);
      expect(q.branches.every((b) => !b.flagged)).toBe(true);
      // Ничего из организации B: ни филиала, ни сотрудника
      expect(q.branches.some((b) => b.terminal_id === tB1.id)).toBe(false);
      expect(q.heavy.some((h) => h.employee_id === heavyB || h.employee_id === ghostB)).toBe(false);
    });

    it("прогульщики и их имена: только heavy, имя в виде «Фамилия Имя»", async () => {
      const q = await qualityReport(db, orgA, P);
      expect(q.heavy).toEqual([{ employee_id: heavyA, days: 10, absent: 10 }]);
      expect(q.employee_names).toEqual({ [heavyA]: nameOf[heavyA] });
      expect(q.employee_names[heavyA]).toMatch(/^Фикстура [0-9a-f]{8} Тест Анвар$/);
      // 9 из 10 и 4 из 4 существуют, но не heavy: имён у них в ответе нет
      expect(q.employee_names[nearA]).toBeUndefined();
    });

    it("организация B не видит строк организации A", async () => {
      const q = await qualityReport(db, orgB, P);
      expect(q.branches).toEqual([
        { terminal_id: tB1.id, terminal_name: tB1.name, days: 25, absent: 25, share: 1, flagged: false },
      ]);
      expect(q.median).toBe(1);
      expect(q.heavy).toEqual([
        { employee_id: heavyB, days: 20, absent: 20 },
        { employee_id: ghostB, days: 5, absent: 5 },
      ]);
      // у «призрака» нет строки в employees: он в heavy, но имени нет
      expect(q.employee_names).toEqual({ [heavyB]: nameOf[heavyB] });
    });

    it("соседние месяцы получают свои граничные дни", async () => {
      const jan = await qualityReport(db, orgA, "2026-01-01");
      expect(jan.branches.map((b) => [b.terminal_id, b.days, b.absent])).toEqual([[tA2.id, 1, 1]]);
      expect(jan.heavy).toEqual([]);
      const mar = await qualityReport(db, orgA, "2026-03-01");
      expect(mar.branches.map((b) => [b.terminal_id, b.days, b.absent])).toEqual([[tA2.id, 1, 1]]);
    });

    it("месяц без данных: пустая форма", async () => {
      expect(await qualityReport(db, orgA, "2026-05-01")).toEqual({ branches: [], median: 0, heavy: [], employee_names: {} });
    });

    it("неизвестная организация: пустая форма", async () => {
      expect(await qualityReport(db, randomUUID(), P)).toEqual({ branches: [], median: 0, heavy: [], employee_names: {} });
    });

    it("работает внутри транзакции", async () => {
      const q = await db.transaction((tx) => qualityReport(tx, orgB, P));
      expect(q.branches).toHaveLength(1);
    });
  });
}
