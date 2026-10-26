import { expect, it } from "bun:test";
import { classifyAuthFailure, createApi } from "../src/api";

const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });

it("без SDK и вне Telegram — отказ без запроса", async () => {
  const calls: string[] = [];
  const f = (async (u: string) => { calls.push(u); return ok({}); }) as any;
  expect(await createApi({ fetch: f, sdk: () => "sdk_failed", initData: () => "" }).auth()).toEqual({ kind: "fail", status: "sdk_failed" });
  expect(await createApi({ fetch: f, sdk: () => "outside", initData: () => "" }).get("/home")).toEqual({ kind: "fail", status: "outside" });
  expect(calls).toEqual([]);
});
it("401 на запросе: один повторный вход и повтор; второй 401 — expired", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const replies = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401),
    ok({ token: "t2", roles: ["employee"], lang: "ru" }), ok({ x: 1 })];
  const f = (async (url: string, init: RequestInit = {}) => { calls.push({ url, auth: new Headers(init.headers).get("Authorization") }); return replies.shift()!; }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q=1" });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  expect(calls.map((c) => [c.url, c.auth])).toEqual([["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t1"], ["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t2"]]);
  replies.push(ok({ error: "unauthorized" }, 401), ok({ token: "t3", roles: [], lang: "ru" }), ok({ error: "unauthorized" }, 401));
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "expired" });
});
it("повторный вход после 401 получил 403 — fail с его статусом, запрос не повторяется", async () => {
  for (const code of ["inactive", "not_bound"] as const) {
    const calls: string[] = [];
    const r = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401), ok({ error: code }, 403)];
    const f = (async (url: string) => { calls.push(url); return r.shift()!; }) as any;
    expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/home")).toEqual({ kind: "fail", status: code });
    expect(calls).toEqual(["/api/kpi/tg/auth", "/api/kpi/tg/home", "/api/kpi/tg/auth"]);
  }
});
it("коды входа и сеть", () => {
  expect([classifyAuthFailure(503, { error: "not_configured" }), classifyAuthFailure(401, { error: "bad_init_data" }),
    classifyAuthFailure(403, { error: "not_bound" }), classifyAuthFailure(403, { error: "inactive" }), classifyAuthFailure(502, null), classifyAuthFailure(418, null)])
    .toEqual(["not_configured", "expired", "not_bound", "inactive", "offline", "unknown"]);
});
it("сеть упала и таймаут — offline; 404 с телом — http", async () => {
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as any;
  expect(await createApi({ fetch: down, sdk: () => "ok", initData: () => "q" }).auth()).toEqual({ kind: "fail", status: "offline" });
  const hang = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as any;
  expect(await createApi({ fetch: hang, sdk: () => "ok", initData: () => "q", timeoutMs: 20 }).auth()).toEqual({ kind: "fail", status: "offline" });
  const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ error: "not_found" }, 404)];
  const f = (async () => r.shift()!) as any;
  expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/review?period=2026-10-01"))
    .toEqual({ kind: "http", code: 404, error: "not_found", body: { error: "not_found" } });
});

// Мои дополнения к тестам брифа: send, blob, 5xx, не-JSON, параллельный вход.
it("send: JSON-тело и Bearer; 5xx — offline; 2xx без JSON — unknown", async () => {
  const seen: { url: string; method?: string; ct: string | null; auth: string | null; body?: unknown }[] = [];
  const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ lang: "uz" }), new Response("<html>", { status: 502 }), new Response("ok", { status: 200 })];
  const f = (async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    seen.push({ url, method: init.method, ct: h.get("Content-Type"), auth: h.get("Authorization"), body: init.body });
    return r.shift()!;
  }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  expect(await a.send("PUT", "/lang", { lang: "uz" })).toEqual({ kind: "ok", data: { lang: "uz" } });
  expect(seen[1]).toEqual({ url: "/api/kpi/tg/lang", method: "PUT", ct: "application/json", auth: "Bearer t", body: '{"lang":"uz"}' });
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "offline" });
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "unknown" });
});
it("blob: байты при 200, null при ошибке и сети; мимо HTTP-кэша", async () => {
  const r: Array<Response | "throw"> = [ok({ token: "t", roles: [], lang: "ru" }), new Response("img", { status: 200 }), new Response("", { status: 404 }), "throw"];
  const modes: (RequestCache | undefined)[] = [];
  const f = (async (_url: string, init: RequestInit = {}) => { modes.push(init.cache); const x = r.shift()!; if (x === "throw") throw new TypeError("net"); return x; }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  const b = await a.blob("/photo/1");
  expect(b && (await b.text())).toBe("img");
  // Решение 13: фото не попадают ни в наш кэш, ни в HTTP-кэш браузера.
  expect(modes[1]).toBe("no-store");
  expect(await a.blob("/photo/2")).toBeNull();
  expect(await a.blob("/photo/3")).toBeNull();
});
it("параллельные запросы без токена делают один вход", async () => {
  let auths = 0;
  const f = (async (url: string) => { if (url.endsWith("/auth")) { auths++; return ok({ token: "t", roles: [], lang: "ru" }); } return ok({ ok: 1 }); }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q" });
  await Promise.all([a.get("/home"), a.get("/history")]);
  expect(auths).toBe(1);
});
it("onAuth: тело каждого удачного входа (и повторного после 401), но не отказа", async () => {
  const seen: unknown[] = [];
  const r = [ok({ token: "t1", roles: ["employee"], lang: "ru", who: "aaaa" }), ok({ error: "unauthorized" }, 401),
    ok({ token: "t2", roles: ["employee"], lang: "uz", who: "bbbb" }), ok({ x: 1 })];
  const f = (async () => r.shift()!) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q", onAuth: (b) => seen.push(b) });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  expect(seen).toEqual([{ token: "t1", roles: ["employee"], lang: "ru", who: "aaaa" }, { token: "t2", roles: ["employee"], lang: "uz", who: "bbbb" }]);
  const denied = createApi({ fetch: (async () => ok({ error: "inactive" }, 403)) as any, sdk: () => "ok", initData: () => "q", onAuth: (b) => seen.push(b) });
  expect(await denied.auth()).toEqual({ kind: "fail", status: "inactive" });
  expect(seen).toHaveLength(2);
});
