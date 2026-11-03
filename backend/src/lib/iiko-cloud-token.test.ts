import { describe, expect, test } from "bun:test";
import { fetchIikoCloudToken, pickIikoAuth } from "./iiko-cloud-token";

const BASE = "https://api-ru.iiko.services/api/1/";

function fakeFetch(status: number, json: unknown) {
  const calls: { url: string; body: any }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(json), { status });
  };
  return { fn, calls };
}

describe("pickIikoAuth", () => {
  test("собирает логин, appId и секрет", () => {
    expect(
      pickIikoAuth([
        { type: "iiko_login", key: "L" },
        { type: "iiko_app_id", key: "A" },
        { type: "iiko_client_secret", key: "S" },
        { type: "iiko_id", key: "X" },
      ])
    ).toEqual({ apiLogin: "L", appId: "A", clientSecret: "S" });
  });

  test("без логина — null", () => {
    expect(pickIikoAuth([{ type: "iiko_id", key: "X" }])).toBeNull();
  });
});

describe("fetchIikoCloudToken", () => {
  test("appId и секрет есть — идёт на v2 с apiKey", async () => {
    const f = fakeFetch(200, { token: "T" });
    const t = await fetchIikoCloudToken(BASE, { apiLogin: "L", appId: "A", clientSecret: "S" }, f.fn);
    expect(t).toBe("T");
    expect(f.calls[0].url).toBe("https://api-ru.iiko.services/api/v2/access_token");
    expect(f.calls[0].body).toEqual({ appId: "A", clientSecret: "S", apiKey: "L" });
  });

  test("appId нет — старая схема v1 с apiLogin", async () => {
    const f = fakeFetch(200, { token: "T" });
    await fetchIikoCloudToken(BASE, { apiLogin: "L" }, f.fn);
    expect(f.calls[0].url).toBe(BASE + "access_token");
    expect(f.calls[0].body).toEqual({ apiLogin: "L" });
  });

  test("ошибка iiko попадает в сообщение, секреты — нет", async () => {
    const f = fakeFetch(403, { errorDescription: "This API key does not support /api/1/access_token." });
    const p = fetchIikoCloudToken(BASE, { apiLogin: "SECRET-LOGIN" }, f.fn);
    await expect(p).rejects.toThrow("403");
    await expect(p).rejects.toThrow("does not support");
    await p.catch((e) => expect(String(e.message)).not.toContain("SECRET-LOGIN"));
  });
});
