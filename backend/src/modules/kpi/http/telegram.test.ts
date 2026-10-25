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
  const { bindingOf, createInvite, recipientOf, redeemInvite, setLang } = await import("../tg/bindings");
  const { employees, kpi_tg_invites, users } = await import("backend/drizzle/schema");
  const { and, gt, isNull, sql } = await import("drizzle-orm");
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
      expect((await redeemInvite(db, a.token, t1)).status).toBe("invalid");
      expect((await redeemInvite(db, b.token, t1)).status).toBe("bound");
      expect((await redeemInvite(db, b.token, t1)).status).toBe("already");
      expect((await redeemInvite(db, b.token, t2)).status).toBe("invalid");
      const c = await createInvite(db, u.id, { employee_id: e.id });
      setNow("2025-11-01T10:00:01+05:00");
      expect((await redeemInvite(db, c.token, t3)).status).toBe("invalid");
      expect((await redeemInvite(db, "not-a-token", t3)).status).toBe("invalid");
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
    it("в KPI_BOT_USERNAME ведущая @ не попадает в ссылку", async () => {
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const saved = process.env.KPI_BOT_USERNAME!;
      process.env.KPI_BOT_USERNAME = " @kpi_test_bot ";
      try {
        const inv = await createInvite(db, u.id, { employee_id: e.id });
        expect(inv.link).toBe(`https://t.me/kpi_test_bot?start=kpi_${inv.token}`);
      } finally { process.env.KPI_BOT_USERNAME = saved; }
    });

    it("неактивный сотрудник и заблокированный пользователь не привязываются; recipientOf их не отдаёт", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const target = await makeUser(db);
      const admin = await makeUser(db);
      const [t1, t2] = [newTelegramId(), newTelegramId()];
      const invE = await createInvite(db, admin.id, { employee_id: e.id });
      const invU = await createInvite(db, admin.id, { user_id: target.id });
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      await db.update(users).set({ status: "blocked" }).where(eq(users.id, target.id));
      expect((await redeemInvite(db, invE.token, t1)).status).toBe("invalid");
      expect((await redeemInvite(db, invU.token, t2)).status).toBe("invalid");
      expect(await bindingOf(db, t1)).toBeNull();
      // Привязка была до увольнения: получателя нет.
      await bindTelegram(db, { employee_id: e.id });
      await bindTelegram(db, { user_id: target.id });
      expect(await recipientOf(db, { recipient_kind: "employee", employee_id: e.id, user_id: null })).toBe("inactive");
      expect(await recipientOf(db, { recipient_kind: "user", employee_id: null, user_id: target.id })).toBe("inactive");
    });

    it("redeemInvite отдаёт имя: сотрудник — «Имя Фамилия», пользователь — имя; повтор тоже", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db, { first_name: "Тест Повар" });
      const u = await makeUser(db, { first_name: "Тест" });
      const [emp] = await db.select().from(employees).where(eq(employees.id, e.id));
      const t = newTelegramId();
      const inv = await createInvite(db, u.id, { employee_id: e.id });
      expect(await redeemInvite(db, inv.token, t)).toEqual({ status: "bound", name: `Тест Повар ${emp.last_name}` });
      expect(await redeemInvite(db, inv.token, t)).toEqual({ status: "already", name: `Тест Повар ${emp.last_name}` });
      const t2 = newTelegramId();
      expect(await redeemInvite(db, (await createInvite(db, u.id, { user_id: u.id })).token, t2)).toEqual({ status: "bound", name: "Тест Оценщик" });
      expect(await redeemInvite(db, "not-a-token", t2)).toEqual({ status: "invalid", name: null });
      // Человека уволили после привязки: повтор той же ссылки уже не «уже подключены».
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      expect(await redeemInvite(db, inv.token, t)).toEqual({ status: "invalid", name: null });
    });

    it("bindingOf и setLang не отдают привязку уволенного сотрудника и заблокированного пользователя", async () => {
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const be = await bindTelegram(db, { employee_id: e.id });
      const bu = await bindTelegram(db, { user_id: u.id });
      expect(await bindingOf(db, be.telegram_id)).toMatchObject({ employee_id: e.id });
      expect(await bindingOf(db, bu.telegram_id)).toMatchObject({ user_id: u.id });
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      await db.update(users).set({ status: "blocked" }).where(eq(users.id, u.id));
      expect(await bindingOf(db, be.telegram_id)).toBeNull();
      expect(await bindingOf(db, bu.telegram_id)).toBeNull();
      expect(await setLang(db, be.telegram_id, "uz")).toBeNull();
      expect(await setLang(db, bu.telegram_id, "uz")).toBeNull();
      const [row] = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.id, be.id));
      expect(row.lang).toBe("ru");
    });

    it("перепривязка обновляет created_at", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const [e1, e2] = [await makeEmployee(db), await makeEmployee(db)];
      const u = await makeUser(db);
      const t1 = newTelegramId();
      await bindTelegram(db, { employee_id: e1.id, telegram_id: t1 });
      await db.update(kpi_tg_bindings).set({ created_at: sql`now() - interval '30 days'` as any }).where(eq(kpi_tg_bindings.telegram_id, t1));
      expect((await redeemInvite(db, (await createInvite(db, u.id, { employee_id: e2.id })).token, t1)).status).toBe("bound");
      const [r] = await db.select().from(kpi_tg_bindings).where(eq(kpi_tg_bindings.telegram_id, t1));
      expect(Date.now() - new Date(r.created_at).getTime()).toBeLessThan(60_000);
    });

    it("одновременные приглашения одному человеку: действующее остаётся одно", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      await Promise.all(Array.from({ length: 6 }, () => createInvite(db, u.id, { employee_id: e.id })));
      const live = await db
        .select({ id: kpi_tg_invites.id })
        .from(kpi_tg_invites)
        .where(and(eq(kpi_tg_invites.employee_id, e.id), isNull(kpi_tg_invites.used_at), gt(kpi_tg_invites.expires_at, new Date("2025-10-25T10:00:00+05:00").toISOString())));
      expect(live).toHaveLength(1);
    });

    it("гонка двух погашений одного человека: без исключения, привязка одна", async () => {
      setNow("2025-10-25T10:00:00+05:00");
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const expires_at = new Date("2025-11-01T10:00:00+05:00").toISOString();
      const tokens = [randomUUID().replace(/-/g, ""), randomUUID().replace(/-/g, "")];
      for (const token of tokens) await db.insert(kpi_tg_invites).values({ token, employee_id: e.id, expires_at, created_by: u.id });
      const res = (await Promise.all(tokens.map((tk) => redeemInvite(db, tk, newTelegramId())))).map((r) => r.status);
      expect(res).toContain("bound");
      expect(res.every((r) => r === "bound" || r === "invalid")).toBe(true);
      const active = await db.select().from(kpi_tg_bindings).where(and(eq(kpi_tg_bindings.employee_id, e.id), eq(kpi_tg_bindings.active, true)));
      expect(active).toHaveLength(1);
    });
  });
}
