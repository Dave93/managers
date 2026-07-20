import { describe, expect, it } from "bun:test";
import { extractBearerToken, isValidApiToken } from "./auth";

describe("extractBearerToken", () => {
  it("извлекает токен из корректного заголовка", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });
  it("возвращает null без заголовка", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });
  it("возвращает null без префикса Bearer", () => {
    expect(extractBearerToken("abc123")).toBeNull();
  });
  it("возвращает null для пустого токена", () => {
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

describe("isValidApiToken", () => {
  const tokens = [
    { token: "active-token", active: true },
    { token: "inactive-token", active: false },
  ];
  it("принимает активный токен", () => {
    expect(isValidApiToken(tokens, "active-token")).toBe(true);
  });
  it("отклоняет неактивный токен", () => {
    expect(isValidApiToken(tokens, "inactive-token")).toBe(false);
  });
  it("отклоняет неизвестный токен", () => {
    expect(isValidApiToken(tokens, "nope")).toBe(false);
  });
});
