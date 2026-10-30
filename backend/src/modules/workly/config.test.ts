import { describe, expect, it } from "bun:test";
import { credsFromEnv } from "./config";

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
