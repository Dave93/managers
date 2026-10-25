import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/attendance-review (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, importAttendance, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_review_items } = await import("backend/drizzle/schema");
  const { and, eq } = await import("drizzle-orm");
  type Card = import("../types").Card;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-11-01";
  const OPEN = "2025-11-25T10:00:00+05:00";

  describe("kpi: предложение «Приход и уход» в форме оценки", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: string[]; // item_id пунктов карты повара: attendance + 6 ручных
    let hr: Session;

    const ATT = () => cookItems[0];
    const manual = (vals: number[]) => vals.map((score, i) => ({ item_id: cookItems[i + 1], score }));
    const FULL = [100, 100, 100, 100, 100, 100];
    const BASIS = "Workly: 3 дня, вовремя 2, опозданий 1, прогулов 0";
    const threeDays = (x: string) => [
      [x, 45962, "09:00", "18:00", 0, ""],
      [x, 45963, "09:20", "18:00", 20, ""],
      [x, 45964, "08:50", "18:00", 0, ""],
    ];
    async function cookWithWorkly() {
      const x = "T-" + randomUUID().slice(0, 8);
      const e = await makeEmployee(db, { role_code: "cook", external_id: x });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      return { e, x, ev };
    }
    const form = (s: Session, id: string) => api(s, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${id}`);
    const draft = (s: Session, id: string, items: unknown[]) => api(s, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: id, items });

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("без строк Workly предложения нет", async () => {
      const { e, ev } = await cookWithWorkly();
      const f = (await form(ev, e.id)).body;
      expect(f.items[0].source).toBe("attendance");
      expect(f.items[0].suggestion).toBeNull();
    });

    it("после импорта форма предлагает балл и основание", async () => {
      const { e, x, ev } = await cookWithWorkly();
      expect((await importAttendance(hr, threeDays(x), P)).status).toBe(200);
      const f = (await form(ev, e.id)).body;
      expect(f.items[0].suggestion).toEqual({ score: 67, basis: BASIS });
      expect(f.items.slice(1).every((i: any) => i.suggestion === null)).toBe(true);
    });

    it("свой балл без заметки — 422; с заметкой — 200; принятое предложение — без заметки", async () => {
      const { e, x, ev } = await cookWithWorkly();
      await importAttendance(hr, threeDays(x), P);
      expect((await draft(ev, e.id, [{ item_id: ATT(), score: 50 }])).body).toEqual({ error: "note_required", item_id: ATT() });
      expect((await draft(ev, e.id, [{ item_id: ATT(), score: 50, note: "болел два дня" }])).status).toBe(200);
      const ok = await draft(ev, e.id, [{ item_id: ATT(), score: 67, note: null }]);
      expect(ok.status).toBe(200);
      expect(ok.body.items[0]).toMatchObject({ score: 67, note: null });
    });

    it("черновик до импорта: отправка {} после импорта требует заметку", async () => {
      setNow(OPEN);
      const { e, x, ev } = await cookWithWorkly();
      const d = await draft(ev, e.id, [{ item_id: ATT(), score: 100 }, ...manual(FULL)]);
      expect(d.status).toBe(200);
      await importAttendance(hr, threeDays(x), P);
      const id = d.body.review.id;
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).body).toEqual({ error: "note_required", item_id: ATT() });
      await draft(ev, e.id, [{ item_id: ATT(), score: 100, note: "Workly не учёл подмену" }]);
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
    });

    it("снимок предложения: повторный импорт не меняет отправленную оценку, правка ручного пункта — 200", async () => {
      setNow(OPEN);
      const { e, x, ev } = await cookWithWorkly();
      await importAttendance(hr, threeDays(x), P);
      const d = await draft(ev, e.id, [{ item_id: ATT(), score: 67 }, ...manual(FULL)]);
      const id = d.body.review.id;
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      const [snap] = await db.select({ v: kpi_review_items.auto_value }).from(kpi_review_items)
        .where(and(eq(kpi_review_items.review_id, id), eq(kpi_review_items.item_id, ATT())));
      expect(snap.v).toEqual({ source: "attendance", days: 3, ontime: 2, late: 1, absent: 0, score: 67, basis: BASIS });

      // Новый файл: все дни вовремя, живое предложение стало бы 100.
      await importAttendance(hr, threeDays(x).map((r) => [r[0], r[1], "08:55", "18:00", 0, ""]), P);
      const f = (await form(ev, e.id)).body;
      expect(f.items[0].suggestion).toEqual({ score: 67, basis: BASIS });

      // Админка шлёт все пункты; нетронутый автопункт заметки не требует.
      const items = [{ item_id: ATT(), score: 67, note: null }, ...manual([75, 100, 100, 100, 100, 100]).map((i) => ({ ...i, note: null }))];
      const ch = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items, comment: "пересмотр чистоты кухни" });
      expect(ch.status).toBe(200);
      expect(ch.body.items[0].suggestion).toEqual({ score: 67, basis: BASIS });
    });
  });
}
