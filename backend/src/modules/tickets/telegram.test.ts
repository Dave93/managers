import { describe, expect, it } from "bun:test";
import { interpretResponse } from "./telegram";

describe("interpretResponse", () => {
  it("успех отдаёт message_id", () => {
    const r = interpretResponse(200, { ok: true, result: { message_id: 42 } });
    expect(r).toEqual({ ok: true, message_id: 42 });
  });

  it("429 отдаёт задержку из retry_after в миллисекундах", () => {
    const r = interpretResponse(429, { ok: false, parameters: { retry_after: 7 }, description: "Too Many Requests" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryAfterMs).toBe(7000);
      expect(r.permanent).toBe(false);
    }
  });

  it("429 без retry_after всё равно временная ошибка", () => {
    const r = interpretResponse(429, { ok: false, description: "Too Many Requests" });
    if (!r.ok) expect(r.permanent).toBe(false);
  });

  it("403 «бот заблокирован» — постоянная ошибка, ретраить бесполезно", () => {
    const r = interpretResponse(403, { ok: false, description: "Forbidden: bot was blocked by the user" });
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("400 «chat not found» — постоянная", () => {
    const r = interpretResponse(400, { ok: false, description: "Bad Request: chat not found" });
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("400 «message is not modified» считаем успехом гашения", () => {
    const r = interpretResponse(400, { ok: false, description: "Bad Request: message is not modified" });
    expect(r.ok).toBe(true);
  });

  it("500 от телеграма — временная", () => {
    const r = interpretResponse(500, { ok: false, description: "Internal Server Error" });
    if (!r.ok) expect(r.permanent).toBe(false);
  });

  it("мусор вместо json — временная ошибка, а не падение", () => {
    const r = interpretResponse(200, null);
    if (!r.ok) expect(r.permanent).toBe(false);
  });
});
