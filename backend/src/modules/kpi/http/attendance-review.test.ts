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
  const { api, cleanupKpi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports } = await import("backend/drizzle/schema");
  type Card = import("../types").Card;
  type Session = Awaited<ReturnType<typeof withSession>>;

  const P = "2025-11-01";
  const OPEN = "2025-11-25T10:00:00+05:00";

  describe("kpi: «Приход и уход» считает система (Workly + выходные), оценщик её не заполняет", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: { id: string; weight: number }[]; // пункты карты повара: attendance + 6 ручных
    let hr: Session;

    const ATT = () => cookItems[0].id;
    const manual = (vals: number[]) => vals.map((score, i) => ({ item_id: cookItems[i + 1].id, score }));
    const FULL = [100, 100, 100, 100, 100, 100];
    const BASIS = "Workly: 3 дня, вовремя 2, опозданий 1, прогулов 0";
    // Σ(score×weight)/Σweight по пунктам с баллом, как scorePct на сервере.
    const pct = (att: number | null, vals: number[]) => {
      const all = [att, ...vals];
      let sum = 0;
      let w = 0;
      all.forEach((v, i) => {
        if (v === null) return;
        sum += v * cookItems[i].weight;
        w += cookItems[i].weight;
      });
      return Math.round((sum / w) * 100) / 100;
    };
    // Посещаемость напрямую в таблицы: загрузка файла через HTTP в этом окружении недоступна.
    async function seedDays(employee_id: string, terminal_id: string, days: { day: string; late?: number }[]) {
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: P, file_name: "attendance-review", uploaded_by: randomUUID(), mapping: {}, rows_total: days.length, rows_matched: days.length })
        .returning({ id: kpi_attendance_imports.id });
      await db.insert(kpi_attendance).values(days.map((d) => ({ employee_id, day: d.day, terminal_id, late_minutes: d.late ?? 0, absent: false, import_id: imp.id })));
    }
    const threeDays = [{ day: "2025-11-03" }, { day: "2025-11-04", late: 10 }, { day: "2025-11-05" }];
    async function cook() {
      const e = await makeEmployee(db, { role_code: "cook" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      return { e, ev };
    }
    const form = (s: Session, id: string) => api(s, "GET", `/api/kpi/reviews/form?period=${P}&employee_id=${id}`);
    const draft = (s: Session, id: string, items: unknown[]) => api(s, "PUT", "/api/kpi/reviews/draft", { period: P, employee_id: id, items });

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      setNow(OPEN);
      hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => ({ id: i.id, weight: i.weight }));
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("без данных Workly предложения нет, балла у пункта нет, итог считается только по ручным", async () => {
      const { e, ev } = await cook();
      const f = (await form(ev, e.id)).body;
      expect(f.items[0]).toMatchObject({ source: "attendance", suggestion: null, score: null });
      const d = await draft(ev, e.id, manual(FULL));
      expect(d.status).toBe(200);
      expect(d.body.items[0]).toMatchObject({ score: null, note: null });
      expect(d.body.review.score_pct).toBe(pct(null, FULL));
    });

    it("форма с данными: балл пункта равен предложению, он же входит в итог ещё до сохранения", async () => {
      const { e, ev } = await cook();
      await seedDays(e.id, e.terminal_id, threeDays);
      const f = (await form(ev, e.id)).body;
      expect(f.items[0]).toMatchObject({ source: "attendance", suggestion: { score: 67, basis: BASIS }, score: 67 });
      expect(f.items.slice(1).every((i: any) => i.suggestion === null)).toBe(true);
    });

    it("ручной ввод по посещаемости игнорируется: ни другой балл, ни «нет данных», ни заметка не принимаются и не требуют заметки", async () => {
      const { e, ev } = await cook();
      await seedDays(e.id, e.terminal_id, threeDays);
      const d = await draft(ev, e.id, [{ item_id: ATT(), score: 0, note: "свой взгляд" }, ...manual(FULL)]);
      expect(d.status).toBe(200);
      expect(d.body.items[0]).toMatchObject({ score: 67, note: null, suggestion: { score: 67, basis: BASIS } });
      expect(d.body.review.score_pct).toBe(pct(67, FULL));
      const nd = await draft(ev, e.id, [{ item_id: ATT(), score: null }, ...manual(FULL)]);
      expect(nd.status).toBe(200);
      expect(nd.body.items[0]).toMatchObject({ score: 67, note: null });
    });

    it("отправка {} без ввода по посещаемости: 200, балл равен предложению, снимок не меняется от новых данных", async () => {
      const { e, ev } = await cook();
      await seedDays(e.id, e.terminal_id, threeDays);
      const d = await draft(ev, e.id, manual(FULL));
      const id = d.body.review.id;
      const sub = await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {});
      expect(sub.status).toBe(200);
      expect(sub.body.items[0]).toMatchObject({ score: 67, note: null, suggestion: { score: 67, basis: BASIS } });
      expect(sub.body.review.score_pct).toBe(pct(67, FULL));
      // Дальше Workly дописывает дни: отправленная оценка остаётся по снимку
      await seedDays(e.id, e.terminal_id, [{ day: "2025-11-06", late: 30 }]);
      const again = (await form(ev, e.id)).body;
      expect(again.items[0]).toMatchObject({ score: 67, suggestion: { score: 67, basis: BASIS } });
      expect(again.review.score_pct).toBe(pct(67, FULL));
    });

    it("изменение отправленной: правка ручного пункта проходит, посещаемость остаётся; правка только посещаемости — 422 no_changes", async () => {
      const { e, ev } = await cook();
      await seedDays(e.id, e.terminal_id, threeDays);
      const d = await draft(ev, e.id, manual(FULL));
      const id = d.body.review.id;
      expect((await api(ev, "POST", `/api/kpi/reviews/${id}/submit`, {})).status).toBe(200);
      const only = await api(ev, "PUT", `/api/kpi/reviews/${id}`, { items: [{ item_id: ATT(), score: 0, note: null }], comment: "пересмотр посещаемости" });
      expect(only).toEqual({ status: 422, body: { error: "no_changes" } });
      const ok = await api(ev, "PUT", `/api/kpi/reviews/${id}`, {
        items: [{ item_id: ATT(), score: 0, note: null }, { item_id: cookItems[1].id, score: 50, note: null }],
        comment: "пересмотр чистоты кухни",
      });
      expect(ok.status).toBe(200);
      expect(ok.body.items[0]).toMatchObject({ score: 67 });
      expect(ok.body.items[1]).toMatchObject({ score: 50 });
      expect(ok.body.review.score_pct).toBe(pct(67, [50, 100, 100, 100, 100, 100]));
    });

    it("черновик до появления данных: после них пункт сам получает балл, отправка без шагов от оценщика", async () => {
      const { e, ev } = await cook();
      const d = await draft(ev, e.id, manual(FULL));
      expect(d.body.items[0].score).toBeNull();
      await seedDays(e.id, e.terminal_id, threeDays);
      const sub = await api(ev, "POST", `/api/kpi/reviews/${d.body.review.id}/submit`, {});
      expect(sub.status).toBe(200);
      expect(sub.body.items[0]).toMatchObject({ score: 67, note: null });
    });
  });
}
