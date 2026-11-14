import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в raises.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/bonus-statement (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, ensureKpiOrg, makeEmployee, makeOrganization, makeScope, makeTerminal, setNow, setup } = await import("./fixtures");
  const { organization } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const ExcelJS = (await import("exceljs")).default;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const Q = "2025-07-01";
  const MONTHS = ["2025-07-01", "2025-08-01", "2025-09-01"];
  const OPEN_AT = ["2025-07-25T10:00:00+05:00", "2025-08-25T10:00:00+05:00", "2025-09-25T10:00:00+05:00"];
  const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  describe("kpi: ведомость на выдачу бонусов (xlsx)", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let hr: Session;
    let approver: Session;
    let evaluator: Session;
    let orgA: { id: string; name: string };
    let orgB: { id: string; name: string };
    let empA: { id: string };
    let empB: { id: string };

    const statement = (s: Session | null, quarter = Q) =>
      callApi(`/api/kpi/raises/statement?quarter=${quarter}`, { headers: s ? { ...s.headers } : {} });
    const sheetTexts = (ws: import("exceljs").Worksheet) => {
      const out: string[] = [];
      ws.eachRow((r) => r.eachCell((c) => typeof c.value === "string" && out.push(c.value)));
      return out;
    };
    const fullName = async (e: { id: string }) => {
      const rows = (await api(approver, "GET", `/api/kpi/raises?quarter=${Q}`)).body as { employee_id: string; employee_name: string }[];
      return rows.find((r) => r.employee_id === e.id)!.employee_name;
    };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      hr = await withSession({ permissions: ["kpi.manage"] });
      const tiers = [{ min_pct: 95, amount: 500000 }, { min_pct: 85, amount: 300000 }, { min_pct: 75, amount: 200000 }];
      expect((await api(hr, "PUT", "/api/kpi/raise-tiers", { tiers })).status).toBe(200);
      approver = await withSession({ permissions: ["kpi.approve"] });
      evaluator = await withSession({ permissions: ["kpi.evaluate"] });
      const idA = await ensureKpiOrg(db);
      const idB = await makeOrganization(db);
      const name = async (id: string) => (await db.select({ name: organization.name }).from(organization).where(eq(organization.id, id)))[0].name;
      orgA = { id: idA, name: await name(idA) };
      orgB = { id: idB, name: await name(idB) };

      const mk = await api(hr, "POST", "/api/kpi/cards", { code: "test_bonus_stmt", title_ru: "Тест ведомость", title_uz: "Test", staff_role_codes: [], sort: 903 });
      const cardId = mk.body.id as string;
      const itemId = (await api(hr, "POST", `/api/kpi/cards/${cardId}/items`, { title_ru: "Один пункт", title_uz: "1", source: "manual", weight: 1, group_key: "base" })).body.id as string;
      const emps: { id: string }[] = [];
      for (const org of [orgA, orgB]) {
        const t = await makeTerminal(db, { iiko_id: null, store_id: null, organization_id: org.id });
        await makeScope(db, evaluator.userId, { terminal_id: t.id });
        const e = await makeEmployee(db, { terminal_id: t.id });
        expect((await api(hr, "PUT", `/api/kpi/employees/${e.id}/card`, { card_id: cardId })).status).toBe(200);
        emps.push(e);
      }
      [empA, empB] = emps;
      for (const e of emps) {
        for (const m of [0, 1]) {
          setNow(OPEN_AT[m]);
          const d = await api(evaluator, "PUT", "/api/kpi/reviews/draft", { period: MONTHS[m], employee_id: e.id, items: [{ item_id: itemId, score: 90 }] });
          expect(d.status).toBe(200);
          expect((await api(evaluator, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {})).status).toBe(200);
        }
      }
      setNow("2025-10-05T10:00:00+05:00");
      expect((await api(approver, "POST", "/api/kpi/raises/compute", { quarter: Q })).status).toBe(200);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("права и квартал: kpi.view → 403, без сессии → 401, кривой квартал → 422", async () => {
      const viewer = await withSession({ permissions: ["kpi.view"] });
      expect((await statement(viewer)).status).toBe(403);
      expect((await statement(null)).status).toBe(401);
      expect((await statement(approver, "2025-08-01")).status).toBe(422);
    });

    it("kpi.approve → xlsx с именем файла по кварталу", async () => {
      const res = await statement(approver);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(XLSX);
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="kpi-bonuses-2025-Q3.xlsx"');
    });

    it("лист на компанию: сотрудник каждой — только на своём листе", async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await (await statement(approver)).arrayBuffer());
      const [nameA, nameB] = [await fullName(empA), await fullName(empB)];
      const wsA = wb.worksheets.find((w) => w.getCell("A1").value === orgA.name)!;
      const wsB = wb.worksheets.find((w) => w.getCell("A1").value === orgB.name)!;
      expect(wsA).toBeDefined();
      expect(wsB).toBeDefined();
      expect(sheetTexts(wsA)).toContain(nameA);
      expect(sheetTexts(wsA)).not.toContain(nameB);
      expect(sheetTexts(wsB)).toContain(nameB);
      expect(sheetTexts(wsB)).not.toContain(nameA);
      // 90 и 90 → средний 90, по шкале теста (от 85 %) 300 000.
      expect(sheetTexts(wsA)).toContain("Итого: 1 чел.");
    });
  });
}
