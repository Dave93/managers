import { afterEach, describe, expect, it } from "bun:test";
import { companyMatches, CONNECTIONS, credsFromEnv, expectedCompanyOf, setExpectedCompanyResolver } from "./config";

// Поддельные значения: настоящие ключи Workly в тестах не нужны.
const full = {
  WORKLY_BASE_URL: "https://api.workly.uz",
  WORKLY_LES_CLIENT_ID: "a",
  WORKLY_LES_CLIENT_SECRET: "b",
  WORKLY_LES_USERNAME: "c",
  WORKLY_LES_PASSWORD: "d",
};

describe("workly/config", () => {
  it("собирает креды LES", () =>
    expect(credsFromEnv("LES", full)).toEqual({
      key: "LES",
      baseUrl: "https://api.workly.uz",
      clientId: "a",
      clientSecret: "b",
      username: "c",
      password: "d",
    }));

  it("null без пароля", () => expect(credsFromEnv("LES", { ...full, WORKLY_LES_PASSWORD: "" })).toBeNull());

  it("CHOPAR не берёт ключи LES", () => expect(credsFromEnv("CHOPAR", full)).toBeNull());

  it("срезает слэш в конце baseUrl", () =>
    expect(credsFromEnv("LES", { ...full, WORKLY_BASE_URL: "https://x.uz/" })!.baseUrl).toBe("https://x.uz"));
});

describe("workly/config: ожидаемая компания подключения", () => {
  afterEach(() => setExpectedCompanyResolver(null));

  it("у каждого подключения своя компания: LES — 1237, CHOPAR — 1238", () => {
    expect(CONNECTIONS.map((c) => [c.key, c.companyId])).toEqual([
      ["LES", 1237],
      ["CHOPAR", 1238],
    ]);
    expect(expectedCompanyOf("LES")).toBe(1237);
    expect(expectedCompanyOf("CHOPAR")).toBe(1238);
  });

  it("companyMatches: совпадение — да, другая компания — нет, без ожидания (null) — проверка пропущена", () => {
    expect(companyMatches(1237, 1237)).toBe(true);
    expect(companyMatches(1237, 1238)).toBe(false);
    expect(companyMatches(1238, 1237)).toBe(false);
    expect(companyMatches(null, 1237)).toBe(true);
  });

  it("подмена для тестов: своя компания или null; null в сеттере возвращает константы", () => {
    setExpectedCompanyResolver((key) => (key === "LES" ? 42 : null));
    expect(expectedCompanyOf("LES")).toBe(42);
    expect(expectedCompanyOf("CHOPAR")).toBeNull();
    setExpectedCompanyResolver(null);
    expect(expectedCompanyOf("LES")).toBe(1237);
  });
});
