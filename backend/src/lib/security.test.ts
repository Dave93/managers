import { describe, expect, it } from "bun:test";
import { clientTime } from "../modules/inventory/counts";
import { corsOrigins, isDbError, LOGIN_LOCK_SECONDS, LOGIN_MAX_FAILS, loginFailed, loginLocked, loginSucceeded } from "./security";

function fakeRedis() {
  const data = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    data,
    ttl,
    get: async (k: string) => (data.has(k) ? String(data.get(k)) : null),
    incr: async (k: string) => {
      data.set(k, (data.get(k) ?? 0) + 1);
      return data.get(k)!;
    },
    expire: async (k: string, s: number) => void ttl.set(k, s),
    del: async (k: string) => void data.delete(k),
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
    const pg = new Error("division by zero");
    pg.name = "PostgresError";
    expect(isDbError(pg)).toBe(true);
    expect(isDbError(new Error("wrapped", { cause: pg }))).toBe(true);
    expect(isDbError(new Error("Нет доступа к терминалу"))).toBe(false);
    expect(isDbError("строка")).toBe(false);
  });
});

describe("лимит попыток входа", () => {
  it(`после ${LOGIN_MAX_FAILS} ошибок логин закрыт, окно — от первой ошибки, регистр логина не важен`, async () => {
    const r = fakeRedis();
    for (let i = 0; i < LOGIN_MAX_FAILS - 1; i++) await loginFailed(r, "Ivan");
    expect(await loginLocked(r, "ivan")).toBe(false);
    await loginFailed(r, " IVAN ");
    expect(await loginLocked(r, "ivan")).toBe(true);
    expect([...r.ttl.values()]).toEqual([LOGIN_LOCK_SECONDS]);
  });
  it("успешный вход сбрасывает счётчик", async () => {
    const r = fakeRedis();
    for (let i = 0; i < 5; i++) await loginFailed(r, "ivan");
    await loginSucceeded(r, "ivan");
    expect(r.data.size).toBe(0);
  });
});

describe("clientTime", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  it("прошлое — как есть в ISO, будущее и мусор — время сервера", () => {
    expect(clientTime("2026-10-12T08:00:00.000Z", now)).toBe("2026-10-12T08:00:00.000Z");
    expect(clientTime("1", now)).toBe(new Date(Date.parse("1")).toISOString());
    expect(clientTime("2026-10-15T10:00:00Z", now)).toBe("2026-10-14T10:00:00.000Z");
    expect(clientTime("не дата", now)).toBe("2026-10-14T10:00:00.000Z");
  });
});
