import { describe, expect, it } from "bun:test";
import { parseStartPayload } from "./bot-controller";

describe("parseStartPayload", () => {
  it("достаёт код приглашения", () => {
    expect(parseStartPayload("/start inv_11111111-2222-3333-4444-555555555555")).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("терпит лишние пробелы", () => {
    expect(parseStartPayload("  /start   inv_11111111-2222-3333-4444-555555555555  ")).toBe(
      "11111111-2222-3333-4444-555555555555"
    );
  });

  it("не принимает чужой префикс", () => {
    expect(parseStartPayload("/start ref_11111111-2222-3333-4444-555555555555")).toBeNull();
  });

  it("не принимает мусор вместо uuid", () => {
    expect(parseStartPayload("/start inv_не-uuid")).toBeNull();
  });

  it("голый /start без кода — не привязка", () => {
    expect(parseStartPayload("/start")).toBeNull();
  });

  it("любое другое сообщение игнорируется", () => {
    expect(parseStartPayload("привет")).toBeNull();
    expect(parseStartPayload("")).toBeNull();
  });
});
