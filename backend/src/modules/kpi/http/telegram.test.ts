import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/telegram (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, makeEmployee, makeUser, newTelegramId, setNow, setup } = await import("./fixtures");
  const { kpi_tg_bindings } = await import("backend/drizzle/schema");
  const { bindingOf, createInvite, redeemInvite } = await import("../tg/bindings");
  const { eq } = await import("drizzle-orm");
  type TgBindingRow = import("../types").TgBindingRow;

  describe("kpi: приглашения и привязки Telegram", () => {
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

    it("приглашение: права и ввод", async () => {
      const view = await withSession({ permissions: ["kpi.view"] });
      expect((await api(view, "POST", "/api/kpi/invites", { employee_id: randomUUID() })).status).toBe(403);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      for (const body of [{}, { employee_id: randomUUID(), user_id: randomUUID() }, { employee_id: "x" }]) {
        expect((await api(hr, "POST", "/api/kpi/invites", body)).body).toEqual({ error: "bad_target" });
      }
      const r = await api(hr, "POST", "/api/kpi/invites", { employee_id: randomUUID() });
      expect([r.status, r.body]).toEqual([404, { error: "not_found" }]);
    });

    it("приглашение сотруднику: токен, ссылка на бота, 7 дней", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const r = await api(hr, "POST", "/api/kpi/invites", { employee_id: e.id });
      expect(r.status).toBe(200);
      expect(r.body.token).toMatch(/^[0-9a-f]{32}$/);
      expect(r.body.link).toBe(`https://t.me/kpi_test_bot?start=kpi_${r.body.token}`);
      expect(r.body.expires_at).toBe("2025-11-01T05:00:00.000Z");
    });

    it("приглашение пользователю — только активному; без KPI_BOT_USERNAME — 409", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const ok = await makeUser(db);
      const blocked = await makeUser(db, { status: "blocked" });
      expect((await api(hr, "POST", "/api/kpi/invites", { user_id: ok.id })).status).toBe(200);
      expect((await api(hr, "POST", "/api/kpi/invites", { user_id: blocked.id })).status).toBe(404);
      const saved = process.env.KPI_BOT_USERNAME!;
      delete process.env.KPI_BOT_USERNAME;
      try { expect((await api(hr, "POST", "/api/kpi/invites", { user_id: ok.id })).body).toEqual({ error: "bot_not_configured" }); }
      finally { process.env.KPI_BOT_USERNAME = saved; }
    });

    it("погашение: bound → already → чужой telegram invalid; новое приглашение гасит старое; просрочка", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const [t1, t2, t3] = [newTelegramId(), newTelegramId(), newTelegramId()];
      const a = await createInvite(db, u.id, { employee_id: e.id });
      const b = await createInvite(db, u.id, { employee_id: e.id });
      expect(await redeemInvite(db, a.token, t1)).toBe("invalid");
      expect(await redeemInvite(db, b.token, t1)).toBe("bound");
      expect(await redeemInvite(db, b.token, t1)).toBe("already");
      expect(await redeemInvite(db, b.token, t2)).toBe("invalid");
      const c = await createInvite(db, u.id, { employee_id: e.id });
      setNow("2025-11-01T10:00:01+05:00");
      expect(await redeemInvite(db, c.token, t3)).toBe("invalid");
      expect(await redeemInvite(db, "not-a-token", t3)).toBe("invalid");
    });

    it("перепривязка: один telegram — один человек; второй телефон гасит первый", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const [e1, e2] = [await makeEmployee(db), await makeEmployee(db)];
      const u = await makeUser(db);
      const [t1, t2] = [newTelegramId(), newTelegramId()];
      await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e1.id })).token, t1);
      await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, t1);
      const byTg = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, t1));
      expect(byTg.map((r) => [r.employee_id, r.user_id, r.active])).toEqual([[e2.id, null, true]]);
      await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, t2);
      const byEmp = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.employee_id, e2.id));
      expect(byEmp.find((r) => r.telegram_id === t1)?.active).toBe(false);
      expect(byEmp.find((r) => r.telegram_id === t2)?.active).toBe(true);
      await redeemInvite(db, (await createInvite(db, u.id, { user_id: u.id })).token, t2);
      expect(await bindingOf(db, t2)).toMatchObject({ employee_id: null, user_id: u.id });
    });

    it("привязки: только активные, проверка id, отвязка", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id, lang: "uz" });
      const u = await makeUser(db);
      await bindTelegram(db, { user_id: u.id, active: false });
      const r = await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}&user_ids=${u.id}`);
      expect(r.body.map((x: TgBindingRow) => [x.id, x.employee_id, x.user_id, x.lang, x.active])).toEqual([[b.id, e.id, null, "uz", true]]);
      expect((await api(hr, "GET", "/api/kpi/tg/bindings?employee_ids=bad")).body).toEqual({ error: "bad_id" });
      const many = Array.from({ length: 201 }, () => randomUUID()).join(",");
      expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${many}`)).body).toEqual({ error: "too_many_ids" });
      expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${b.id}`)).status).toBe(200);
      expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${b.id}`)).status).toBe(200);
      expect((await api(hr, "DELETE", `/api/kpi/tg/bindings/${randomUUID()}`)).status).toBe(404);
      expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}`)).body).toEqual([]);
      const view = await withSession({ permissions: ["kpi.view"] });
      expect((await api(view, "GET", `/api/kpi/tg/bindings?employee_ids=${e.id}`)).status).toBe(403);
    });
  });
}
