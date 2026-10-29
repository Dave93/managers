import { afterEach, describe, expect, it } from "bun:test";
import { realBotApi } from "./bot-api";

const TOKEN = "123456:SECRET-token_abc";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// fetch, который не отвечает никогда, но уважает signal, как настоящий.
const hangingFetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason ?? new Error("aborted")));
  })) as unknown as typeof fetch;

describe("realBotApi: таймаут", () => {
  it("send: зависший запрос даёт временную ошибку timeout", async () => {
    globalThis.fetch = hangingFetch;
    const r = await realBotApi(TOKEN, 50).send(1, { text: "x" });
    expect(r).toEqual({ ok: false, permanent: false, error: "timeout" });
  });

  it("answerCallback: зависший запрос обрывается и считается временным", async () => {
    globalThis.fetch = hangingFetch;
    const r = await realBotApi(TOKEN, 50).answerCallback("cb1", "ok");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).toBe(false);
  });
});

describe("realBotApi: токен не попадает в ошибки", () => {
  const failing = (() => Promise.reject(new Error(`fetch failed: https://api.telegram.org/bot${TOKEN}/sendMessage`))) as unknown as typeof fetch;

  it("send", async () => {
    globalThis.fetch = failing;
    const r = await realBotApi(TOKEN, 1000).send(1, { text: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.permanent).toBe(false);
      expect(r.error).not.toContain(TOKEN);
      expect(r.error).toContain("***");
    }
  });

  it("answerCallback", async () => {
    globalThis.fetch = failing;
    const r = await realBotApi(TOKEN, 1000).answerCallback("cb1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain(TOKEN);
      expect(r.error).toContain("***");
    }
  });

  it("описание ошибки Telegram с токеном тоже чистится", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify({ ok: false, description: `bad ${TOKEN}` }), { status: 400 }))) as unknown as typeof fetch;
    const r = await realBotApi(TOKEN, 1000).answerCallback("cb1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("bad ***");
  });
});
