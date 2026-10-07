import { describe, expect, it } from "bun:test";
import { parseStartPayload, resolveBindLang } from "./bot-controller";

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

describe("resolveBindLang", () => {
  it("сохраняет язык, заданный в карточке", () => {
    expect(resolveBindLang("uz", "ru")).toBe("uz");
    expect(resolveBindLang("ru", "uz")).toBe("ru");
  });

  it("берёт язык телеграма, если в карточке дефолт и телеграм узбекский", () => {
    expect(resolveBindLang(null, "uz")).toBe("uz");
    expect(resolveBindLang(undefined, "uz")).toBe("uz");
  });

  it("падает на русский, когда неизвестно ничего", () => {
    expect(resolveBindLang(null, undefined)).toBe("ru");
    expect(resolveBindLang(null, "en")).toBe("ru");
  });

  it("не принимает мусор вместо языка", () => {
    expect(resolveBindLang(null, { evil: true } as any)).toBe("ru");
    expect(resolveBindLang(42 as any, "uz")).toBe("uz");
  });
});
