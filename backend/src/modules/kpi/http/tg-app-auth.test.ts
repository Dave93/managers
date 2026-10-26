import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

// Тот же guard, что в me.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app auth (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, sweepTestRoles, withSession } = await import("../../../../tests/helpers/http");
  const { api, bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeUser, newTelegramId, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } =
    await import("./fixtures");
  const { employees, kpi_tg_bindings } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");
  const { bindingOf } = await import("../tg/bindings");
  const { signInitData } = await import("../tg-app/init-data");
  const { principalOf } = await import("../tg-app/ctx");
  const { tgAppRoutes } = await import("../routes/tg-app");
  const { Elysia } = await import("elysia");
  const { eq } = await import("drizzle-orm");

  const nowSec = () => Math.floor(Date.now() / 1000);
  const sessionKey = (token: string) => `managers_test_kpi_tg_session:${token}`;

  describe("kpi: вход в мини-приложение, сессия, язык", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let redis: Redis;
    let prevToken: string | undefined;
    let f: ReturnType<typeof fakeBotApi>;

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      redis = new Redis({ host: process.env.REDIS_HOST ?? "localhost", port: parseInt(process.env.REDIS_PORT ?? "6379") });
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
    }, 180000);

    beforeEach(() => {
      f = fakeBotApi();
      setTestBotApi(f.api);
    });

    afterAll(async () => {
      // undefined в process.env стал бы строкой "undefined", и botApi() в следующих файлах пошёл бы в Telegram.
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
      await redis.quit();
      // closeTestRedis не зовём: соединение общее для всех файлов прогона.
    });

    it("без KPI_BOT_TOKEN — 503 not_configured", async () => {
      delete process.env.KPI_BOT_TOKEN;
      try { expect(await tgLogin(newTelegramId())).toEqual({ status: 503, body: { error: "not_configured" } }); }
      finally { process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN; }
    });

    // Решение 21: тестовый токен из репозитория вне managers_test_ и managers_smoke_ — как незаданный.
    // Отказ раньше любого обращения к Redis и базе, поэтому подмена префикса не трогает чужие ключи.
    it("тестовый токен бота под боевым PROJECT_PREFIX — 503 not_configured даже с верной подписью", async () => {
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      expect((await tgLogin(b.telegram_id)).status).toBe(200); // без подмены префикса тот же вход проходит
      const prevPrefix = process.env.PROJECT_PREFIX;
      process.env.PROJECT_PREFIX = "managers_";
      try {
        expect(await tgLogin(b.telegram_id)).toEqual({ status: 503, body: { error: "not_configured" } });
        // Пробел перед токеном в .env проверку не обходит.
        process.env.KPI_BOT_TOKEN = " " + TG_TEST_BOT_TOKEN;
        expect(await tgLogin(b.telegram_id, { token: " " + TG_TEST_BOT_TOKEN })).toEqual({ status: 503, body: { error: "not_configured" } });
      } finally {
        if (prevPrefix === undefined) delete process.env.PROJECT_PREFIX;
        else process.env.PROJECT_PREFIX = prevPrefix;
        process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
      }
    });

    it("подпись чужим токеном, устаревшая, мусор — 401 bad_init_data", async () => {
      const tg = newTelegramId();
      expect(await tgLogin(tg, { token: "999:other" })).toEqual({ status: 401, body: { error: "bad_init_data" } });
      expect((await tgLogin(tg, { auth_date: nowSec() - 86_401 })).body).toEqual({ error: "bad_init_data" });
      for (const init_data of ["", "hash=abc", 42, null]) {
        expect((await api(null, "POST", "/api/kpi/tg/auth", { init_data })).status).toBe(401);
      }
    });

    it("нет привязки и снятая — 403 not_bound; уволенный и заблокированный — 403 inactive", async () => {
      expect((await tgLogin(newTelegramId())).body).toEqual({ error: "not_bound" });
      const e = await makeEmployee(db);
      const off = await bindTelegram(db, { employee_id: e.id, active: false });
      expect((await tgLogin(off.telegram_id)).body).toEqual({ error: "not_bound" });
      const fired = await makeEmployee(db, { active: false });
      expect(await tgLogin((await bindTelegram(db, { employee_id: fired.id })).telegram_id)).toEqual({ status: 403, body: { error: "inactive" } });
      const blocked = await makeUser(db, { status: "blocked" });
      expect((await tgLogin((await bindTelegram(db, { user_id: blocked.id })).telegram_id)).body).toEqual({ error: "inactive" });
    });

    it("сотрудник: роли, язык, сессия в Redis на 12 часов", async () => {
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id, lang: "uz" });
      const r = await tgLogin(b.telegram_id);
      expect(r.status).toBe(200);
      expect(r.body.token).toMatch(/^[0-9a-f]{64}$/);
      expect([r.body.roles, r.body.lang]).toEqual([["employee"], "uz"]);
      const key = `managers_test_kpi_tg_session:${r.body.token}`;
      expect(JSON.parse((await redis.get(key))!)).toEqual({ telegram_id: b.telegram_id, employee_id: e.id, user_id: null, lang: "uz" });
      const ttl = await redis.ttl(key);
      expect(ttl > 43_000 && ttl <= 43_200).toBe(true);
    });

    it("две привязки — обе роли; уволенный руководитель с живой привязкой оценщика — только evaluator", async () => {
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
      expect((await tgLogin(b.telegram_id)).body.roles).toEqual(["employee", "evaluator"]);
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      expect((await tgLogin(b.telegram_id)).body.roles).toEqual(["evaluator"]);
    });

    it("guard: без токена и с чужим — 401; снятая привязка и увольнение закрывают доступ сразу", async () => {
      expect((await tgApi(null, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).body).toEqual({ error: "unauthorized" });
      expect((await tgApi("f".repeat(64), "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(401);
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(200);
      await db.update(kpi_tg_bindings).set({ active: false }).where(eq(kpi_tg_bindings.id, b.id));
      expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(401);
      const e2 = await makeEmployee(db);
      const b2 = await bindTelegram(db, { employee_id: e2.id });
      const t2 = (await tgLogin(b2.telegram_id)).body.token;
      await db.update(employees).set({ active: false }).where(eq(employees.id, e2.id));
      expect((await tgApi(t2, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(401);
    });

    it("guard: мусор в Redis под ключом сессии и кривой заголовок — 401", async () => {
      const e = await makeEmployee(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(200);
      const ttl = await redis.ttl(sessionKey(token));
      for (const raw of ["abc", "123", "null", "{}", JSON.stringify({ telegram_id: String(b.telegram_id), employee_id: e.id, user_id: null, lang: "ru" })]) {
        await redis.set(sessionKey(token), raw, "EX", ttl);
        expect(await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).toEqual({ status: 401, body: { error: "unauthorized" } });
      }
      await redis.del(sessionKey(token));
      // Токен без «Bearer» и с лишним словом — нет сессии.
      for (const authorization of [token, `Basic ${token}`, `Bearer ${token} x`]) {
        const res = await callApi("/api/kpi/tg/lang", {
          method: "PUT",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({ lang: "ru" }),
        });
        expect(res.status).toBe(401);
      }
    });

    it("principalOf: у руководителя увольнение отрезает только часть сотрудника, язык — из привязки", async () => {
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      const s = JSON.parse((await redis.get(sessionKey(token)))!);
      expect(await principalOf(db, s)).toEqual({ telegram_id: b.telegram_id, employee_id: e.id, user_id: u.id, lang: "ru" });
      await db.update(kpi_tg_bindings).set({ lang: "uz" }).where(eq(kpi_tg_bindings.telegram_id, b.telegram_id));
      await db.update(employees).set({ active: false }).where(eq(employees.id, e.id));
      expect(await principalOf(db, s)).toEqual({ telegram_id: b.telegram_id, employee_id: null, user_id: u.id, lang: "uz" });
      // Сессия по-прежнему открывает приложение как оценщику.
      expect(await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).toEqual({ status: 200, body: { lang: "ru" } });
      // Привязка того же telegram_id теперь другого сотрудника: часть сотрудника из старой сессии не действует.
      const e2 = await makeEmployee(db);
      await db.update(kpi_tg_bindings).set({ employee_id: e2.id }).where(eq(kpi_tg_bindings.id, b.id));
      expect((await principalOf(db, s))?.employee_id).toBeNull();
      expect(await principalOf(db, { ...s, user_id: null })).toBeNull();
    });

    it("язык: обе привязки, кривой — 422 bad_lang", async () => {
      const e = await makeEmployee(db);
      const u = await makeUser(db);
      const b = await bindTelegram(db, { employee_id: e.id });
      await bindTelegram(db, { user_id: u.id, telegram_id: b.telegram_id });
      const token = (await tgLogin(b.telegram_id)).body.token;
      expect(await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).toEqual({ status: 200, body: { lang: "uz" } });
      const p = await bindingOf(db, b.telegram_id);
      expect([p.employee?.lang, p.user?.lang]).toEqual(["uz", "uz"]);
      expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "en" })).body).toEqual({ error: "bad_lang" });
    });

    it("язык uz переставляет кнопку меню без ожидания, повтор того же языка Telegram не зовёт", async () => {
      const URL_ = "https://x.test/kpi-app/";
      const saved = process.env.KPI_MINIAPP_URL;
      process.env.KPI_MINIAPP_URL = URL_;
      try {
        const e = await makeEmployee(db);
        const b = await bindTelegram(db, { employee_id: e.id });
        const token = (await tgLogin(b.telegram_id)).body.token;
        expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "ru" })).status).toBe(200);
        expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(200);
        // вызов не ожидается роутом: ждём опросом
        for (let i = 0; i < 50 && f.menus.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
        expect(f.menus).toEqual([expect.objectContaining({ chatId: b.telegram_id, text: "Mening KPI", url: URL_ })]);
        expect((await tgApi(token, "PUT", "/api/kpi/tg/lang", { lang: "uz" })).status).toBe(200);
        await new Promise((r) => setTimeout(r, 1000));
        expect(f.menus).toHaveLength(1);
      } finally {
        if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved;
      }
    });

    it("guard не задевает cookie-роуты и вебхук", async () => {
      const hr = await withSession({ permissions: ["kpi.manage"] });
      expect((await api(hr, "GET", `/api/kpi/tg/bindings?employee_ids=${randomUUID()}`)).status).toBe(200);
      const res = await callApi("/api/kpi/bot/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": process.env.KPI_WEBHOOK_SECRET! },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(res.status).toBe(200);
      // Роут, объявленный в app.ts после контроллера KPI: guard с утечкой выше tgAppRoutes отдал бы здесь 401.
      expect((await api(hr, "GET", "/api/users/my_permissions")).status).toBe(200);
    });

    // Не зависит от порядка .use() в app.ts и controller.ts: роут, объявленный после tgAppRoutes в чужом
    // экземпляре, ловит и "global" у kpiTgCtx, и лишний .as(...) у самого tgAppRoutes.
    it("канарейка: guard не выходит за пределы tgAppRoutes", async () => {
      // Хост не короче "localhost": Elysia ищет начало пути с фиксированного смещения в URL.
      const app = new Elysia().use(tgAppRoutes).get("/canary", () => "ok");
      const res = await app.handle(new Request("http://localhost/canary"));
      expect([res.status, await res.text()]).toEqual([200, "ok"]);
      // Плагин действительно подключён: его собственный роут без токена закрыт.
      const lang = await app.handle(
        new Request("http://localhost/kpi/tg/lang", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: "ru" }) })
      );
      expect(lang.status).toBe(401);
    });

    it("init_data и токен сессии не попадают в консоль", async () => {
      const logs: string[] = [];
      const orig = { log: console.log, error: console.error, warn: console.warn };
      for (const k of ["log", "error", "warn"] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
      try {
        const e = await makeEmployee(db);
        const b = await bindTelegram(db, { employee_id: e.id });
        const init = signInitData(TG_TEST_BOT_TOKEN, { telegram_id: b.telegram_id, auth_date: nowSec() });
        const ok = await api(null, "POST", "/api/kpi/tg/auth", { init_data: init });
        expect(ok.status).toBe(200);                                   // иначе фильтр ниже искал бы "undefined"
        await api(null, "POST", "/api/kpi/tg/auth", { init_data: init + "x" });
        expect((await tgApi(ok.body.token, "PUT", "/api/kpi/tg/lang", { lang: "en" })).status).toBe(422);
        const hash = new URLSearchParams(init).get("hash")!;
        expect(logs.filter((l) => l.includes(hash) || l.includes(ok.body.token))).toEqual([]);
      } finally { Object.assign(console, orig); }
    });
  });
}
