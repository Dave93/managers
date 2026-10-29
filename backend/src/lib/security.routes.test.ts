import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest || !prefixLooksLikeTest) {
  describe.skip("security routes (пропущено: запускайте через bun run test:http:security)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { callApi, closeTestRedis, ensureApp, withSession, sweepTestRoles } = await import("../../tests/helpers/http");
  const { drizzleDb } = await import("backend/src/lib/db");
  const { eq, sql } = await import("drizzle-orm");
  const { users } = await import("backend/drizzle/schema");
  const { hashPassword } = await import("./bcrypt");
  const { isDbError, LOGIN_MAX_FAILS } = await import("./security");

  // Первый импорт приложения долгий (кэш ролей и прав из базы) — не в счёт таймаута теста.
  beforeAll(async () => {
    await ensureApp();
  }, 120_000);

  afterAll(async () => {
    await sweepTestRoles();
    await closeTestRedis();
  });

  const login = (name: string, password = "wrong-password") =>
    callApi("/api/users/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: name, password }),
    });

  describe("CORS", () => {
    it("чужой сайт не получает разрешения читать ответ, админка — получает", async () => {
      const evil = await callApi("/api/users/me", { headers: { Origin: "https://evil.example" } });
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
      const sub = await callApi("/api/users/me", { headers: { Origin: "https://mn.lesailes.uz" } });
      expect(sub.headers.get("access-control-allow-origin")).toBeNull();
      const office = await callApi("/api/users/me", { headers: { Origin: "https://office.lesailes.uz" } });
      expect(office.headers.get("access-control-allow-origin")).toBe("https://office.lesailes.uz");
      expect(office.headers.get("access-control-allow-credentials")).toBe("true");
    });
  });

  describe("вход", () => {
    it("нет такого логина — тот же ответ, что и на неверный пароль; после лимита — 429", async () => {
      const name = `nobody_${randomUUID().slice(0, 8)}`;
      const first = await login(name);
      expect(first.status).toBe(401);
      expect(await first.json()).toEqual({ message: "Invalid login or password" });
      for (let i = 1; i < LOGIN_MAX_FAILS; i++) expect((await login(name)).status).toBe(401);
      const locked = await login(name.toUpperCase());
      expect(locked.status).toBe(429);
      // Другой логин не задет.
      expect((await login(`other_${randomUUID().slice(0, 8)}`)).status).toBe(401);
    });

    it("пачка параллельных попыток не обходит лимит", async () => {
      const name = `burst_${randomUUID().slice(0, 8)}`;
      const codes = (await Promise.all(Array.from({ length: 30 }, () => login(name)))).map((r) => r.status);
      expect(codes.filter((c) => c === 401).length).toBe(LOGIN_MAX_FAILS);
      expect(codes.filter((c) => c === 429).length).toBe(30 - LOGIN_MAX_FAILS);
    });

    it("настоящий пользователь: неверный пароль — общий ответ; верный — куки httpOnly, на проде ещё Secure и домен", async () => {
      const s = await withSession({ permissions: [] }); // кладёт роль в кэш ролей — без неё вход не соберёт сессию
      const name = `sec_${randomUUID().slice(0, 8)}`;
      const { hash, salt } = await hashPassword("right-password");
      const [u] = await drizzleDb
        .insert(users)
        .values({ login: name, password: hash, salt, status: "active", role_id: s.roleId })
        .returning({ id: users.id });
      const env = process.env.ENV;
      try {
        const wrong = await login(name);
        expect(wrong.status).toBe(401);
        expect(await wrong.json()).toEqual({ message: "Invalid login or password" });

        process.env.ENV = "development";
        const dev = await login(name, "right-password");
        expect(dev.status).toBe(200);
        const devCookies = dev.headers.getSetCookie().join("\n");
        expect(devCookies).toContain("sessionId=");
        expect(devCookies).toContain("HttpOnly");

        delete process.env.ENV;
        const prod = await login(name, "right-password");
        expect(prod.status).toBe(200);
        for (const c of prod.headers.getSetCookie().filter((c) => /^(sessionId|refreshToken)=/.test(c))) {
          expect(c).toContain("HttpOnly");
          expect(c).toContain("Secure");
          expect(c).toMatch(/Domain=\.?lesailes\.uz/);
        }
        expect(prod.headers.getSetCookie().filter((c) => /^(sessionId|refreshToken)=/.test(c)).length).toBe(2);
      } finally {
        if (env === undefined) delete process.env.ENV;
        else process.env.ENV = env;
        await drizzleDb.delete(users).where(eq(users.id, u.id));
        await s.cleanup();
      }
    });
  });

  describe("ошибки базы", () => {
    it("ответ без SQL: старый маршрут, не-UUID в id — Postgres падает на приведении типа", async () => {
      const s = await withSession({ permissions: ["users.one"] });
      try {
        const res = await callApi("/api/users/not-a-uuid", { headers: s.headers });
        const text = await res.text();
        expect(res.status).toBe(500);
        expect(text).not.toContain("select");
        expect(text).not.toContain("Failed query");
        expect(JSON.parse(text)).toEqual({ message: "Internal server error" });
      } finally {
        await s.cleanup();
      }
    });
    it("настоящая ошибка drizzle распознаётся как ошибка базы", async () => {
      const err = await drizzleDb.execute(sql`select 1/0`).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).not.toBeNull();
      expect(isDbError(err)).toBe(true);
    });
  });
}
