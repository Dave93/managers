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
  const { sql } = await import("drizzle-orm");
  const { isDbError, LOGIN_MAX_FAILS } = await import("./security");

  // Первый импорт приложения долгий (кэш ролей и прав из базы) — не в счёт таймаута теста.
  beforeAll(async () => {
    await ensureApp();
  }, 120_000);

  afterAll(async () => {
    await sweepTestRoles();
    await closeTestRedis();
  });

  const login = (name: string) =>
    callApi("/api/users/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: name, password: "wrong-password" }),
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
