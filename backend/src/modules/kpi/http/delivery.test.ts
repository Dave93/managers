import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/delivery (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeUser, setNow, setup } = await import("./fixtures");
  const { employees, kpi_notifications, kpi_periods } = await import("backend/drizzle/schema");
  const { users } = await import("backend/drizzle/schema");
  const { enqueue } = await import("../notify");
  const { deliverOne, pendingIds, stuckSendingCount, sweepPending } = await import("../worker/deliver");
  const { eq, sql } = await import("drizzle-orm");
  type BotApi = import("../tg/bot-api").BotApi;

  describe("kpi: доставка уведомления и подметалка", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
    }, 180000);

    afterAll(async () => {
      setNow(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    const P10 = "2025-10-01";
    const RID = randomUUID();
    const row = async (id: string) => (await db.select().from(kpi_notifications).where(eq(kpi_notifications.id, id)))[0];
    const note = async (o: { employee_id?: string; user_id?: string; kind?: string; payload?: Record<string, unknown> }) =>
      (await enqueue(db, {
        recipient_kind: o.user_id ? "user" : "employee", employee_id: o.employee_id, user_id: o.user_id,
        kind: o.kind ?? "review_submitted", payload: o.payload ?? { period: P10, review_id: RID, score_pct: 83.33 },
        dedupe_key: `t:${randomUUID()}`,
      }))!;
    const go = (id: string, api: BotApi | null, lastAttempt = false) => deliverOne(db, id, { api, lastAttempt });

    it("без токена — skipped no_token, без отправки", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const id = await note({ employee_id: e.id });
      expect(await go(id, null)).toEqual({ result: "skipped", reason: "no_token" });
      const r = await row(id);
      expect([r.status, r.last_error, r.attempts]).toEqual(["skipped", "no_token", 1]);
    });

    it("без привязки и с неактивной — skipped no_binding", async () => {
      const f = fakeBotApi();
      const a = await makeEmployee(db);
      const b = await makeEmployee(db); await bindTelegram(db, { employee_id: b.id, active: false });
      for (const e of [a, b]) expect(await go(await note({ employee_id: e.id }), f.api)).toEqual({ result: "skipped", reason: "no_binding" });
      expect(f.sent).toHaveLength(0);
    });

    it("успех до срока споров: текст, кнопка, sent; повтор — noop", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const e = await makeEmployee(db); const b = await bindTelegram(db, { employee_id: e.id });
      const id = await note({ employee_id: e.id });
      const f = fakeBotApi();
      expect(await go(id, f.api)).toEqual({ result: "sent" });
      expect(f.sent[0].chatId).toBe(b.telegram_id);
      expect(f.sent[0].msg.text).toContain("Итог: 83,33 %.");
      expect((f.sent[0].msg.reply_markup as any).inline_keyboard[0][0].callback_data).toBe(`dispute:review:${RID}`);
      const r = await row(id);
      expect([r.status, r.tg_message_id, r.attempts]).toEqual(["sent", "42", 1]);
      expect(r.sent_at).not.toBeNull();
      expect(await go(id, f.api)).toEqual({ result: "noop" });
      expect(f.sent).toHaveLength(1);
    });

    it("после срока споров и в закрытом месяце кнопки нет", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const f = fakeBotApi();
      setNow("2025-11-11T10:00:00+05:00");
      await go(await note({ employee_id: e.id }), f.api);
      setNow("2025-11-05T10:00:00+05:00");
      await db.insert(kpi_periods).values({ period: P10, status: "closed" });
      try { await go(await note({ employee_id: e.id }), f.api); }
      finally { await db.delete(kpi_periods).where(eq(kpi_periods.period, P10)); }
      expect(f.sent.map((s) => s.msg.reply_markup)).toEqual([undefined, undefined]);
    });

    it("узбекская привязка — узбекский текст и кнопка", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id, lang: "uz" });
      const f = fakeBotApi();
      await go(await note({ employee_id: e.id }), f.api);
      expect(f.sent[0].msg.text).toContain("Natija: 83,33 %.");
      expect((f.sent[0].msg.reply_markup as any).inline_keyboard[0][0].text).toBe("Eʼtiroz bildirish");
    });

    it("429 — retry с паузой, строка снова pending", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const id = await note({ employee_id: e.id });
      const f = fakeBotApi([{ ok: false, permanent: false, retryAfterMs: 7000, error: "Too Many Requests" }]);
      expect(await go(id, f.api)).toEqual({ result: "retry", error: "Too Many Requests", retryAfterMs: 7000 });
      expect([(await row(id)).status, (await row(id)).last_error]).toEqual(["pending", "Too Many Requests"]);
    });

    it("постоянная ошибка — failed; временная — pending, на последней попытке — failed", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const blocked = { ok: false as const, permanent: true, error: "Forbidden: bot was blocked by the user" };
      const temp = { ok: false as const, permanent: false, error: "Bad Gateway" };
      const a = await note({ employee_id: e.id });
      expect(await go(a, fakeBotApi([blocked]).api)).toEqual({ result: "failed", error: blocked.error });
      const b = await note({ employee_id: e.id });
      expect(await go(b, fakeBotApi([temp]).api)).toEqual({ result: "retry", error: "Bad Gateway" });
      expect((await row(b)).status).toBe("pending");
      expect(await go(b, fakeBotApi([temp]).api, true)).toEqual({ result: "failed", error: "Bad Gateway" });
      expect([(await row(b)).status, (await row(b)).attempts]).toEqual(["failed", 2]);
    });

    it("неизвестный kind — failed unknown_kind", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const id = await note({ employee_id: e.id, kind: "weird", payload: {} });
      expect(await go(id, fakeBotApi().api)).toEqual({ result: "failed", error: "unknown_kind:weird" });
    });

    it("получатель-пользователь находится по user_id", async () => {
      const u = await makeUser(db); const b = await bindTelegram(db, { user_id: u.id });
      const f = fakeBotApi();
      await go(await note({ user_id: u.id, kind: "remind_evaluate", payload: { period: P10, pending: 2, deadline: "2025-11-07T18:59:59.999Z" } }), f.api);
      expect(f.sent[0].chatId).toBe(b.telegram_id);
      expect(f.sent[0].msg.text).toContain("Ждут вашей оценки: 2 сотрудника.");
    });

    it("подметалка: только pending старше 60 с; зависшие sending считаются", async () => {
      const e = await makeEmployee(db);
      const old = await note({ employee_id: e.id });
      const fresh = await note({ employee_id: e.id });
      const stuck = await note({ employee_id: e.id });
      await db.update(kpi_notifications).set({ created_at: sql`now() - interval '2 minutes'` as any }).where(eq(kpi_notifications.id, old));
      await db.update(kpi_notifications).set({ status: "sending", created_at: sql`now() - interval '20 minutes'` as any }).where(eq(kpi_notifications.id, stuck));
      const ids = await pendingIds(db, 60, 200);
      expect(ids).toContain(old);
      expect(ids).not.toContain(fresh);
      expect(ids).not.toContain(stuck);
      expect(await stuckSendingCount(db, 15)).toBeGreaterThanOrEqual(1);
    });

    it("исключение из send не оставляет sending", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const boom: BotApi = { send: async () => { throw new Error("socket hang up"); }, answerCallback: async () => ({ ok: true, message_id: null }) };
      const a = await note({ employee_id: e.id });
      expect(await go(a, boom)).toEqual({ result: "retry", error: "socket hang up" });
      expect((await row(a)).status).toBe("pending");
      expect(await go(a, boom, true)).toEqual({ result: "failed", error: "socket hang up" });
      expect((await row(a)).status).toBe("failed");
    });

    it("сбой чтения базы на шаге получателя — retry, на последней попытке failed, не sending", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const a = await note({ employee_id: e.id });
      // Ломаем kind у settings: loadSettings читает kpi_settings, его падение имитируем подменой db.select только на этом вызове.
      const real = db.select.bind(db);
      let calls = 0;
      const flaky = new Proxy(db, {
        get(t, p, r) {
          if (p === "select") return (...args: any[]) => { if (++calls === 1) throw new Error("db down"); return (real as any)(...args); };
          const v = Reflect.get(t, p, r);
          return typeof v === "function" ? v.bind(t) : v;
        },
      }) as typeof db;
      expect(await deliverOne(flaky, a, { api: fakeBotApi().api, lastAttempt: false })).toEqual({ result: "retry", error: "db down" });
      expect((await row(a)).status).toBe("pending");
      calls = 0;
      expect(await deliverOne(flaky, a, { api: fakeBotApi().api, lastAttempt: true })).toEqual({ result: "failed", error: "db down" });
      expect([(await row(a)).status, (await row(a)).last_error]).toEqual(["failed", "db down"]);
    });

    it("review_changed в окне споров несёт кнопку (R5), violation_recorded после срока — нет", async () => {
      setNow("2025-11-05T10:00:00+05:00");
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const f = fakeBotApi();
      await go(await note({ employee_id: e.id, kind: "review_changed", payload: { period: P10, review_id: RID, score_pct: 80, old_score_pct: 83.33, by_dispute: true } }), f.api);
      expect((f.sent[0].msg.reply_markup as any)?.inline_keyboard[0][0].callback_data).toBe(`dispute:review:${RID}`);
      setNow("2025-11-11T10:00:00+05:00");
      await go(await note({ employee_id: e.id, kind: "violation_recorded", payload: { period: P10, violation_id: randomUUID(), type: "late", amount: 1000 } }), f.api);
      expect(f.sent[1].msg.reply_markup).toBeUndefined();
    });

    it("неактивный сотрудник и заблокированный пользователь — skipped inactive_recipient", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      const u = await makeUser(db); await bindTelegram(db, { user_id: u.id });
      await db.update(users).set({ status: "blocked" }).where(eq(users.id, u.id));
      const f = fakeBotApi();
      const a = await note({ employee_id: e.id });
      const b = await note({ user_id: u.id, kind: "remind_evaluate", payload: { period: P10, pending: 1, deadline: "2025-11-07T18:59:59.999Z" } });
      expect(await go(a, f.api)).toEqual({ result: "skipped", reason: "inactive_recipient" });
      expect(await go(b, f.api)).toEqual({ result: "skipped", reason: "inactive_recipient" });
      expect([(await row(a)).status, (await row(a)).last_error]).toEqual(["skipped", "inactive_recipient"]);
      expect(f.sent).toHaveLength(0);
    });

    // Подметалка с поддельной очередью: состояние задачи задаётся словарём, остальные ids — «задачи нет».
    const fakeQueue = (states: Record<string, string>) => {
      const calls: string[] = [];
      const q = {
        getJob: async (j: string) => (states[j] ? { getState: async () => states[j] } : undefined),
        remove: async (j: string) => { calls.push(`remove:${j}`); },
        add: async (_n: string, data: any, o: any) => { calls.push(`add:${o.jobId}:${data.notificationId}:${o.removeOnComplete ? "roc" : "-"}`); },
      };
      return { q, calls };
    };
    const oldPending = async () => {
      const e = await makeEmployee(db);
      const id = await note({ employee_id: e.id });
      await db.update(kpi_notifications).set({ created_at: sql`now() - interval '5 minutes'` as any }).where(eq(kpi_notifications.id, id));
      return id;
    };

    it("sweepPending: завершённую или упавшую задачу убирает и добавляет заново с jobId = id", async () => {
      const id = await oldPending();
      const { q, calls } = fakeQueue({ [id]: "failed" });
      const res = await sweepPending(db, q, { olderThanSec: 60, limit: 200 });
      expect(res.queued).toBeGreaterThanOrEqual(1);
      expect(calls.indexOf(`remove:${id}`)).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf(`add:${id}:${id}:roc`)).toBe(calls.indexOf(`remove:${id}`) + 1);
    });

    it("sweepPending: нет задачи — просто add; живая задача (delayed/waiting/active/...) не трогается", async () => {
      const gone = await oldPending();
      const live = await Promise.all(["delayed", "waiting", "active", "prioritized", "waiting-children"].map(async (s) => [s, await oldPending()] as const));
      const { q, calls } = fakeQueue(Object.fromEntries(live.map(([s, id]) => [id, s])));
      const res = await sweepPending(db, q, { olderThanSec: 60, limit: 200 });
      expect(calls).toContain(`add:${gone}:${gone}:roc`);
      for (const [, id] of live) expect(calls.some((c) => c.endsWith(id) || c.includes(`:${id}:`))).toBe(false);
      expect(res.busy).toBeGreaterThanOrEqual(5);
    });

    it("sweepPending: сбой remove — строка пропущена, add не вызывается", async () => {
      const id = await oldPending();
      const failing = {
        getJob: async () => ({ getState: async () => "completed" }),
        remove: async () => { throw new Error("job is locked"); },
        add: async () => { throw new Error("must not add"); },
      };
      const r = await sweepPending(db, failing, { olderThanSec: 60 });
      expect(r.skipped).toBeGreaterThanOrEqual(1);
      expect((await row(id)).status).toBe("pending");
    });

    it("sweepPending: attempts >= 20 — failed too_many_attempts, в очередь не возвращается", async () => {
      const id = await oldPending();
      await db.update(kpi_notifications).set({ attempts: 20 }).where(eq(kpi_notifications.id, id));
      const { q, calls } = fakeQueue({});
      const res = await sweepPending(db, q, { olderThanSec: 60, limit: 200 });
      expect(res.failed).toBeGreaterThanOrEqual(1);
      expect(calls.some((c) => c.includes(id))).toBe(false);
      const r = await row(id);
      expect([r.status, r.last_error]).toEqual(["failed", "too_many_attempts"]);
    });

    it("успех после временной ошибки очищает last_error", async () => {
      const e = await makeEmployee(db); await bindTelegram(db, { employee_id: e.id });
      const id = await note({ employee_id: e.id });
      expect(await go(id, fakeBotApi([{ ok: false, permanent: false, error: "Bad Gateway" }]).api)).toEqual({ result: "retry", error: "Bad Gateway" });
      expect((await row(id)).last_error).toBe("Bad Gateway");
      expect(await go(id, fakeBotApi().api)).toEqual({ result: "sent" });
      expect([(await row(id)).status, (await row(id)).last_error]).toEqual(["sent", null]);
    });
  });
}
