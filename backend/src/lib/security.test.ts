import { describe, expect, it } from "bun:test";
import { clientTime } from "../modules/inventory/counts";
import { corsOrigins, isDbError, LOGIN_LOCK_SECONDS, LOGIN_MAX_FAILS, loginAttempt, loginSucceeded, publicMessage } from "./security";

// Повторяет Lua-скрипт loginAttempt: INCR, и срок, если у ключа его нет (TTL -1).
function fakeRedis() {
  const data = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    data,
    ttl,
    eval: async (_script: string, _n: number, k: string, seconds: number) => {
      data.set(k, (data.get(k) ?? 0) + 1);
      if (!ttl.has(k)) ttl.set(k, seconds);
      return data.get(k)!;
    },
    del: async (k: string) => {
      data.delete(k);
      ttl.delete(k);
    },
  };
}

describe("corsOrigins", () => {
  it("прод — только админка и сам API, плюс CORS_ORIGINS", () => {
    expect(corsOrigins({})).toEqual(["https://office.lesailes.uz", "https://api.office.lesailes.uz"]);
    expect(corsOrigins({ CORS_ORIGINS: " https://a.lesailes.uz, ,https://b.uz" })).toEqual([
      "https://office.lesailes.uz",
      "https://api.office.lesailes.uz",
      "https://a.lesailes.uz",
      "https://b.uz",
    ]);
  });
  it("разработка — ещё localhost на любом порту", () => {
    const local = corsOrigins({ ENV: "development" }).find((o) => o instanceof RegExp) as RegExp;
    expect(local.test("http://localhost:6762")).toBe(true);
    expect(local.test("http://127.0.0.1")).toBe(true);
    expect(local.test("http://localhost.evil.example")).toBe(false);
    expect(corsOrigins({}).some((o) => o instanceof RegExp)).toBe(false);
  });
});

describe("isDbError", () => {
  it("ошибка запроса drizzle и postgres — да, остальное — нет", () => {
    expect(isDbError(new Error("Failed query: select 1\nparams: "))).toBe(true);
    // Так выглядит DatabaseError драйвера pg: name "error", severity и SQLSTATE.
    const pg = Object.assign(new Error("division by zero"), { name: "error", severity: "ERROR", code: "22012" });
    expect(isDbError(pg)).toBe(true);
    expect(isDbError(new Error("wrapped", { cause: pg }))).toBe(true);
    // Сетевые ошибки Node тоже несут code, но не SQLSTATE и без severity.
    expect(isDbError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isDbError(new Error("Нет доступа к терминалу"))).toBe(false);
    expect(isDbError("строка")).toBe(false);
  });
});

describe("publicMessage", () => {
  it("ошибку базы прячет, остальные отдаёт как есть", () => {
    expect(publicMessage(new Error("Failed query: select * from users where id = $1\nparams: x"))).toBe("Internal server error");
    expect(publicMessage(new Error("Кандидат не найден"))).toBe("Кандидат не найден");
    expect(publicMessage({ message: "plain" })).toBe("plain");
    expect(publicMessage(null)).toBe("Unknown error");
  });
});

describe("лимит попыток входа", () => {
  it(`${LOGIN_MAX_FAILS} попыток можно, следующая — нет; срок ставится сразу; регистр логина не важен`, async () => {
    const r = fakeRedis();
    for (let i = 0; i < LOGIN_MAX_FAILS; i++) expect(await loginAttempt(r, i % 2 ? "Ivan" : " IVAN ")).toBe(true);
    expect(await loginAttempt(r, "ivan")).toBe(false);
    expect([...r.ttl.values()]).toEqual([LOGIN_LOCK_SECONDS]);
  });
  it("ключ без срока (остался от старой версии) получает срок при следующей попытке", async () => {
    const r = fakeRedis();
    r.data.set(`${process.env.PROJECT_PREFIX}login_fail:ivan`, 3);
    expect(await loginAttempt(r, "ivan")).toBe(true);
    expect([...r.ttl.values()]).toEqual([LOGIN_LOCK_SECONDS]);
  });
  it("Redis недоступен — попытку пропускаем, вход не падает", async () => {
    const down = { eval: async () => Promise.reject(new Error("ECONNREFUSED")), del: async () => Promise.reject(new Error("ECONNREFUSED")) };
    expect(await loginAttempt(down, "ivan")).toBe(true);
    await loginSucceeded(down, "ivan");
  });
  it("удачный вход сбрасывает счётчик", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 5; i++) await loginAttempt(r, "ivan");
    await loginSucceeded(r, "ivan");
    expect(r.data.size).toBe(0);
  });
});

describe("clientTime", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  const created = Date.parse("2026-10-10T09:00:00Z");
  it("прошлое после создания пересчёта — как есть в ISO, будущее и мусор — время сервера", () => {
    expect(clientTime("2026-10-12T08:00:00.000Z", now, created)).toBe("2026-10-12T08:00:00.000Z");
    expect(clientTime("2026-10-15T10:00:00Z", now, created)).toBe("2026-10-14T10:00:00.000Z");
    expect(clientTime("не дата", now, created)).toBe("2026-10-14T10:00:00.000Z");
  });
  it("раньше создания пересчёта («0», «1» — это 2000–2001 годы) — время сервера; 5 минут допуска", () => {
    expect(clientTime("0", now, created)).toBe("2026-10-14T10:00:00.000Z");
    expect(clientTime("1", now, created)).toBe("2026-10-14T10:00:00.000Z");
    expect(clientTime("2026-10-10T08:57:00Z", now, created)).toBe("2026-10-10T08:57:00.000Z");
    expect(clientTime("2026-10-10T08:50:00Z", now, created)).toBe("2026-10-14T10:00:00.000Z");
  });
});
