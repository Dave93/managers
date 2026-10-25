import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в branch.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/branch-review (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { addBranchResult, api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_review_items } = await import("backend/drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-05-01";
  const OPEN = "2025-05-25T10:00:00+05:00";

  // Версия общая для месяца, как у настоящего расчёта: тесты файла идут по порядку,
  // и каждый берёт номер версии больше прошлых.
  describe("kpi: предложения автопунктов из балла филиала", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let managerItems: string[];

    const sug = (f: any, source: string) => f.items.find((i: any) => i.source === source).suggestion;
    async function manager() {
      const e = await makeEmployee(db, { role_code: "manager", first_name: "Тест Менеджер" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      return { e, ev };
    }
    const form = (s: Session, id: string) => api(s, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${id}`);
    const result = (terminal_id: string, version: number, code: string, fact: number | null, points: number | null) =>
      addBranchResult(db, { period: P, terminal_id, version, code, fact, points });

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      managerItems = cards.find((c) => c.code === "manager")!.items.map((i) => i.id);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("форма менеджера и повара: предложения из последней версии", async () => {
      const { e, ev } = await manager();
      await result(e.terminal_id, 1, "sales", 103, 104);
      await result(e.terminal_id, 1, "food_cost", 0.6, 90);
      const f = (await form(ev, e.id)).body;
      expect(sug(f, "sales_plan")).toEqual({ score: 100, basis: "Филиал: продажи 103% плана → 104,0 балла" });
      expect(sug(f, "food_cost")).toEqual({ score: 90, basis: "Филиал: перерасход сырья 0,6% выручки → 90,0 балла" });
      const c = await makeEmployee(db, { role_code: "cook", terminal_id: e.terminal_id });
      await result(e.terminal_id, 1, "service", 90, 91.67);
      expect(sug((await form(ev, c.id)).body, "cooking_speed")).toEqual({ score: 92, basis: "Филиал: заказов в норматив 90% → 91,7 балла" });
    });

    it("последняя версия без данных — предложения нет, к старой не откатываемся; чужой филиал — нет", async () => {
      const { e, ev } = await manager();
      await result(e.terminal_id, 2, "sales", 103, 104);
      await result(e.terminal_id, 3, "sales", null, null);
      expect(sug((await form(ev, e.id)).body, "sales_plan")).toBeNull();
      const other = await manager();
      expect(sug((await form(other.ev, other.e.id)).body, "sales_plan")).toBeNull();
    });

    it("свой балл без заметки — 422 note_required", async () => {
      const { e, ev } = await manager();
      await result(e.terminal_id, 4, "sales", 103, 104);
      const salesItem = managerItems[6];
      expect(
        (await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: e.id, items: [{ item_id: salesItem, score: 80 }] })).body
      ).toEqual({ error: "note_required", item_id: salesItem });
    });

    it("снимок предложения: пересчёт после отправки не меняет оценку, черновик видит новую версию", async () => {
      setNow(OPEN);
      const { e, ev } = await manager();
      await result(e.terminal_id, 7, "sales", 103, 104);
      await result(e.terminal_id, 7, "food_cost", 0.6, 90);
      const all = managerItems.map((id, i) => ({ item_id: id, score: i === 6 ? 100 : i === 7 ? 90 : i === 0 ? null : 100 }));
      const d = await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: e.id, items: all });
      expect((await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {})).status).toBe(200);
      const [snap] = await db
        .select({ v: kpi_review_items.auto_value })
        .from(kpi_review_items)
        .where(and(eq(kpi_review_items.review_id, d.body.review.id), eq(kpi_review_items.item_id, managerItems[6])));
      expect(snap.v).toEqual({
        source: "sales_plan",
        indicator: "sales",
        terminal_id: e.terminal_id,
        version: 7,
        fact: 103,
        points: 104,
        score: 100,
        basis: "Филиал: продажи 103% плана → 104,0 балла",
      });
      await result(e.terminal_id, 8, "sales", 95, 75);
      expect(sug((await form(ev, e.id)).body, "sales_plan")).toEqual({ score: 100, basis: "Филиал: продажи 103% плана → 104,0 балла" });
      const peer = await makeEmployee(db, { role_code: "manager", terminal_id: e.terminal_id, first_name: "Тест Менеджер" });
      expect(sug((await form(ev, peer.id)).body, "sales_plan")).toEqual({ score: 75, basis: "Филиал: продажи 95% плана → 75,0 балла" });
      setNow(null);
    });
  });
}
