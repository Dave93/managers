import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/notify (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, cleanupKpi, fakeBotApi, makeEmployee, makeScope, setNow, setup } = await import("./fixtures");
  const { kpi_notifications } = await import("backend/drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { collectDeliveries, enqueue } = await import("../notify");
  const { getKpiQueue, kpiQueueName } = await import("../queue");
  const { botApi, setTestBotApi } = await import("../tg/bot-api");
  type Card = import("../types").Card;

  const P10 = "2025-10-01";

  describe("kpi: очередь уведомлений", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let cookItems: string[];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const cards = (await api(hr, "GET", "/api/kpi/cards")).body as Card[];
      cookItems = cards.find((c) => c.code === "cook")!.items.map((i) => i.id);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("очередь теста — не боевая", () => expect(kpiQueueName()).toBe("kpi_notify_test"));

    it("id из транзакции доходят до schedule после коммита; дубль dedupe_key — null", async () => {
      const e = await makeEmployee(db);
      const n = { recipient_kind: "employee" as const, employee_id: e.id, kind: "review_submitted", payload: { period: P10 }, dedupe_key: `test:${e.id}` };
      const got: string[][] = [];
      let first: string | null = null;
      await collectDeliveries(
        () =>
          db.transaction(async (tx) => {
            first = await enqueue(tx, n);
            expect(await enqueue(tx, n)).toBeNull();
          }),
        (ids) => got.push(ids)
      );
      expect(first).not.toBeNull();
      expect(got).toEqual([[first!]]);
    });

    it("откат транзакции — schedule не зовётся, строки нет", async () => {
      const e = await makeEmployee(db);
      const key = `test:rollback:${e.id}`;
      const got: string[][] = [];
      await expect(
        collectDeliveries(
          () =>
            db.transaction(async (tx) => {
              await enqueue(tx, { recipient_kind: "employee", employee_id: e.id, kind: "review_submitted", payload: {}, dedupe_key: key });
              throw new Error("откат");
            }),
          (ids) => got.push(ids)
        )
      ).rejects.toThrow("откат");
      expect(got).toEqual([]);
      expect(await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, key))).toHaveLength(0);
    });

    it("отправка оценки через API ставит задачу deliver с jobId = id уведомления", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db, { role_code: "cook" });
      const ev = await withSession({ permissions: ["kpi.evaluate"] });
      await makeScope(db, ev.userId, { terminal_id: e.terminal_id });
      const items = [1, 2, 3, 4, 5, 6].map((i) => ({ item_id: cookItems[i], score: 100 }));
      const d = await api(ev, "PUT", "/api/kpi/reviews/draft", { period: P10, employee_id: e.id, items });
      expect(d.status).toBe(200);
      const reviewId = d.body.review.id as string;
      const sub = await api(ev, "POST", `/api/kpi/reviews/${reviewId}/submit`, {});
      expect(sub.status).toBe(200);

      const [row] = await db.select().from(kpi_notifications).where(eq(kpi_notifications.dedupe_key, `review_submitted:${reviewId}`));
      expect(row).toBeDefined();
      let job = null;
      for (let i = 0; i < 20 && !job; i++) {
        job = await getKpiQueue().getJob(row.id);
        if (!job) await Bun.sleep(100);
      }
      expect(job?.name).toBe("deliver");
      expect(job?.data).toEqual({ notificationId: row.id });
      expect(job?.opts.removeOnComplete).toEqual({ age: 3600, count: 1000 });
      expect(job?.opts.removeOnFail).toEqual({ age: 86400 });
    });

    it("botApi: подмена в тестах, без токена и подмены — null", () => {
      const f = fakeBotApi();
      setTestBotApi(f.api);
      expect(botApi()).toBe(f.api);
      setTestBotApi(null);
      const saved = process.env.KPI_BOT_TOKEN;
      delete process.env.KPI_BOT_TOKEN;
      try {
        expect(botApi()).toBeNull();
      } finally {
        if (saved !== undefined) process.env.KPI_BOT_TOKEN = saved;
      }
    });
  });
}
